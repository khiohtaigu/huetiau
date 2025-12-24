import React, { useState, useEffect, useRef, useMemo } from 'react';
import { auth, db, googleProvider } from './firebase'; 
import { signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, query, onSnapshot, doc, updateDoc, writeBatch, getDocs, setDoc, increment, where, deleteDoc } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import { LogOut, Upload, Camera, CheckSquare, XSquare, FileText, Loader2, User, ChevronDown, ChevronUp, PencilLine, Eye, ShieldCheck, ListFilter, Trash2 } from 'lucide-react';
import { toPng } from 'html-to-image';

ChartJS.register(ArcElement, Tooltip, Legend);

function App() {
  const [user, setUser] = useState(null);
  const [allStudents, setAllStudents] = useState([]);
  const [receipts, setReceipts] = useState([]); 
  const [activeReceiptId, setActiveReceiptId] = useState(null); 
  const [visitorCount, setVisitorCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [eventTitle, setEventTitle] = useState(""); 
  const [expandedGrade, setExpandedGrade] = useState("高一");
  const [activeClass, setActiveClass] = useState(null); 
  const reportRef = useRef(null);
  const isFirstLoadRef = useRef(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    const trackVisitor = async () => {
      try {
        const statsRef = doc(db, "system", "stats");
        if (!sessionStorage.getItem('hasVisited')) {
          await setDoc(statsRef, { views: increment(1) }, { merge: true });
          sessionStorage.setItem('hasVisited', 'true');
        }
        onSnapshot(statsRef, (docSnap) => {
          if (docSnap.exists()) setVisitorCount(docSnap.data().views || 0);
        });
      } catch (e) { console.error(e); }
    };
    trackVisitor();
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "users", user.uid, "receipts"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setReceipts(data);
      if (data.length > 0 && !activeReceiptId) setActiveReceiptId(data[data.length - 1].id);
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user || !activeReceiptId) { setAllStudents([]); return; }
    const q = query(collection(db, "users", user.uid, "students"), where("receiptId", "==", activeReceiptId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // 排序邏輯
      data.sort((a, b) => a.class === b.class ? a.no.localeCompare(b.no) : a.class.localeCompare(b.class, 'zh-Hant'));
      setAllStudents(data);
      if (isFirstLoadRef.current && data.length > 0) {
        setActiveClass(data[0].class);
        isFirstLoadRef.current = false;
      }
    });
    return () => unsubscribe();
  }, [user, activeReceiptId]);

  const getGradeGroup = (className) => {
    if (!className) return "其他";
    const name = String(className).trim();
    if (/^[123]\d{2}$/.test(name)) {
      if (name.startsWith('1')) return "高一";
      if (name.startsWith('2')) return "高二";
      if (name.startsWith('3')) return "高三";
    }
    return "其他";
  };

  const classList = useMemo(() => [...new Set(allStudents.map(s => s.class))].sort(), [allStudents]);
  const handleGradeClick = (grade) => {
    setExpandedGrade(expandedGrade === grade ? null : grade);
    setActiveClass(null);
  };

  const displayStudents = useMemo(() => {
    if (expandedGrade === "全校") return allStudents;
    return activeClass ? allStudents.filter(s => s.class === activeClass) : [];
  }, [allStudents, expandedGrade, activeClass]);

  const unsubmittedStudents = displayStudents.filter(s => !s.isDone);
  const doneCount = displayStudents.length - unsubmittedStudents.length;
  const total = displayStudents.length;
  const currentReceiptName = receipts.find(r => r.id === activeReceiptId)?.name || "";

  const handleBulkUpdate = async (status) => {
    if (displayStudents.length === 0) return;
    if (!window.confirm(`確定更新狀態？`)) return;
    setIsUploading(true);
    try {
      const batchSize = 500;
      for (let i = 0; i < displayStudents.length; i += batchSize) {
        const batch = writeBatch(db);
        displayStudents.slice(i, i + batchSize).forEach(s => batch.update(doc(db, "users", user.uid, "students", s.id), { isDone: status }));
        await batch.commit();
      }
    } catch (err) { console.error(err); } finally { setIsUploading(false); }
  };

  // --- 關鍵修正：座號格式化 (班級-座號) ---
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const receiptName = window.prompt("請輸入回條清單名稱", "新回條");
    if (!receiptName) return;
    setIsUploading(true);
    isFirstLoadRef.current = true;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const receiptId = `r_${Date.now()}`;
        await setDoc(doc(db, "users", user.uid, "receipts", receiptId), { name: receiptName, createdAt: Date.now() });
        const workbook = XLSX.read(new Uint8Array(event.target.result), { type: 'array' });
        let allEntries = [];
        
        workbook.SheetNames.forEach(sheetName => {
          const worksheet = workbook.Sheets[sheetName];
          const json = XLSX.utils.sheet_to_json(worksheet);
          
          json.forEach((row, i) => {
            const originalName = String(row['姓名'] || row['學生姓名'] || '未知').trim();
            const originalNo = String(row['座號'] || (i + 1)).padStart(2, '0');
            const originalClass = String(row['班級'] || '').trim();
            
            let finalNo = originalNo;
            let groupLabel = sheetName;

            // 如果有「社團」欄位，判定為社團模式
            if (row['社團'] || row['社團名稱'] || row['類別']) {
                groupLabel = row['社團'] || row['社團名稱'] || row['類別'];
                // 座號改為 班級-座號
                finalNo = originalClass ? `${originalClass}-${originalNo}` : originalNo;
            } else {
                groupLabel = originalClass || sheetName;
            }

            allEntries.push({ 
              receiptId, 
              class: String(groupLabel).trim(), 
              no: finalNo, 
              name: originalName, 
              isDone: false, 
              note: '' 
            });
          });
        });
        for (let i = 0; i < allEntries.length; i += 500) {
          const batch = writeBatch(db);
          allEntries.slice(i, i + 500).forEach((item, j) => {
            batch.set(doc(db, "users", user.uid, "students", `s_${receiptId}_${i + j}`), item);
          });
          await batch.commit();
        }
        setActiveReceiptId(receiptId);
      } catch (err) { alert("上傳失敗"); } finally { setIsUploading(false); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = null;
  };

  if (loading) return <div className="h-screen flex items-center justify-center bg-[#C3CCD8] font-bold">載入中...</div>;

  if (!user) return (
    <div className="h-screen flex items-center justify-center bg-[#C3CCD8]">
      <div className="bg-white p-12 rounded-2xl shadow-2xl text-center border-t-8 border-slate-700">
        <FileText size={64} className="mx-auto text-blue-500 mb-6" />
        <h1 className="text-3xl font-black text-slate-700 mb-8 tracking-tighter">學生回條回收系統</h1>
        <button onClick={() => signInWithPopup(auth, googleProvider)} className="bg-slate-800 text-white px-10 py-4 rounded-xl font-bold shadow-lg hover:bg-black transition active:scale-95">Google 快速登入</button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen w-screen bg-[#C3CCD8] overflow-hidden font-sans text-slate-800">
      
      <main className="flex-1 flex flex-col h-full overflow-hidden p-5 lg:p-6 gap-4">
        
        <div className="flex-none bg-white border border-slate-400 p-4 lg:p-6 shadow-sm flex items-center justify-center gap-4 rounded-sm">
          <PencilLine className="text-slate-200" size={36} />
          <div className="flex items-center gap-2">
            <input type="text" value={eventTitle} onChange={(e) => setEventTitle(e.target.value)} placeholder="活動名稱" className="text-4xl lg:text-5xl font-serif text-slate-700 bg-transparent focus:outline-none border-b border-transparent hover:border-slate-200 transition-all text-right min-w-[150px]" />
            <span className="text-4xl lg:text-5xl font-serif text-slate-800 whitespace-nowrap font-bold tracking-tight">回條清單</span>
          </div>
        </div>

        <div className="flex flex-col gap-2 flex-none no-print">
          <div className="flex gap-2 justify-center items-center">
            {["高一", "高二", "高三", "其他", "全校"].map(g => (
              <button key={g} onClick={() => handleGradeClick(g)} className={`px-8 py-2.5 rounded-xl font-black text-base flex items-center gap-2 transition-all ${expandedGrade === g ? 'bg-[#5B6B7E] text-white shadow-md scale-105' : 'bg-[#95A3B5] text-slate-100 hover:bg-slate-200/50'}`}>
                {g} {g !== "全校" && (expandedGrade === g ? <ChevronUp size={16}/> : <ChevronDown size={16}/>)}
              </button>
            ))}
            
            <div className="mx-2 h-10 w-[1px] bg-slate-400 opacity-40"></div>

            <div className="flex flex-col gap-1 min-w-[180px]">
              <div className="flex items-center bg-white/60 px-2 py-1 rounded-lg border border-slate-400 shadow-sm">
                <ListFilter size={14} className="text-slate-500 mr-1"/>
                <select value={activeReceiptId || ""} onChange={(e) => {setActiveReceiptId(e.target.value); setActiveClass(null); isFirstLoadRef.current = true;}} className="bg-transparent font-bold text-slate-700 focus:outline-none cursor-pointer text-xs w-full">
                  <option value="" disabled>切換回條...</option>
                  {receipts.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              {activeReceiptId && (
                <button onClick={() => {
                  if (window.confirm(`確定刪除「${currentReceiptName}」？`)) {
                    setIsUploading(true);
                    const q = query(collection(db, "users", user.uid, "students"), where("receiptId", "==", activeReceiptId));
                    getDocs(q).then(s => {
                      const b = writeBatch(db);
                      s.docs.forEach(d => b.delete(d.ref));
                      return b.commit();
                    }).then(() => deleteDoc(doc(db, "users", user.uid, "receipts", activeReceiptId)))
                    .then(() => { setActiveReceiptId(null); setActiveClass(null); setIsUploading(false); });
                  }
                }} className="text-[10px] font-bold text-slate-500 hover:text-red-600 transition flex items-center justify-center gap-1 tracking-tighter"><Trash2 size={10}/> 刪除此回條及數據</button>
              )}
            </div>
          </div>

          {expandedGrade && expandedGrade !== "全校" && (
            <div className="p-2.5 bg-[#AEB9C8]/50 rounded-2xl border border-white/20 flex flex-wrap gap-2 justify-center animate-in fade-in slide-in-from-top-2">
              {classList.filter(cls => getGradeGroup(cls) === expandedGrade).map(cls => (
                <button key={cls} onClick={() => setActiveClass(cls)} className={`px-5 py-2 rounded-xl text-white font-bold text-sm transition-all ${activeClass === cls ? 'bg-[#5B6B7E] shadow-lg scale-110' : 'bg-[#95A3B5]'}`}>
                  {/^\d+$/.test(cls) ? `${cls} 班` : cls}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar bg-white border border-slate-400 rounded-sm shadow-xl">
          {activeReceiptId && (activeClass || expandedGrade === "全校") ? (
            <table className="w-full border-collapse">
              <thead className="bg-[#F2C2C2] sticky top-0 z-20 shadow-sm text-sm font-bold">
                <tr className="text-slate-700 border-b">
                  <th className="p-3 w-20 border-r">班級</th>
                  <th className="p-3 w-24 border-r">座號</th>
                  <th className="p-3 text-left pl-8 border-r">姓名</th>
                  <th className="p-3 w-44 text-center border-r">
                    <div className="flex flex-col items-center gap-1.5">
                       <span className="text-xs font-black">繳交狀態</span>
                       <div className="flex gap-2 no-print">
                          <button onClick={() => handleBulkUpdate(true)} className="bg-green-600 text-white text-[10px] px-2 py-0.5 rounded shadow-sm font-black tracking-tight">全交</button>
                          <button onClick={() => handleBulkUpdate(false)} className="bg-red-600 text-white text-[10px] px-2 py-0.5 rounded shadow-sm font-black tracking-tight">清空</button>
                       </div>
                    </div>
                  </th>
                  <th className="p-3">備註</th>
                </tr>
              </thead>
              <tbody>
                {displayStudents.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50 border-b border-slate-200 h-11 transition-colors text-slate-800">
                    <td className="text-center font-bold text-slate-500 border-r">{s.class}</td>
                    <td className="text-center font-bold text-slate-400 border-r tracking-tighter">{s.no}</td>
                    <td className={`font-bold pl-8 text-xl border-r ${s.isDone ? 'text-slate-300 font-normal' : 'text-slate-700'}`}>{s.name}</td>
                    <td className="text-center w-20 border-r">
                      <div className="flex justify-center gap-4">
                        <button onClick={() => updateDoc(doc(db, "users", user.uid, "students", s.id), { isDone: true })} className="active:scale-75 transition">
                          {s.isDone ? <div className="bg-green-500 rounded p-1 border border-green-800 shadow-sm"><CheckSquare className="text-white" size={24}/></div> : <div className="w-8 h-8 bg-slate-100 rounded border border-slate-200"></div>}
                        </button>
                        <button onClick={() => updateDoc(doc(db, "users", user.uid, "students", s.id), { isDone: false })} className="active:scale-75 transition">
                          {!s.isDone ? <div className="bg-red-500 rounded p-1 border border-red-800 shadow-sm"><XSquare className="text-white" size={24}/></div> : <div className="w-8 h-8 bg-slate-100 rounded border border-slate-200"></div>}
                        </button>
                      </div>
                    </td>
                    <td className="p-1.5"><input type="text" defaultValue={s.note} onBlur={(e) => updateDoc(doc(db, "users", user.uid, "students", s.id), { note: e.target.value })} className="w-full bg-transparent focus:outline-none px-3 text-slate-400 text-sm italic" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-300 font-bold italic text-xl p-10 text-center">請選取班級名單</div>
          )}
        </div>
      </main>

      {/* 右側固定側邊欄 */}
      <aside className="w-[420px] h-full bg-[#AEB9C8] border-l border-slate-300 p-6 flex flex-col items-center gap-4 shadow-2xl flex-none no-print overflow-hidden">
        
        <div className="flex flex-col w-full gap-2.5">
          <div className="bg-white border border-slate-400 px-4 py-2.5 rounded-xl shadow-md text-sm font-black flex justify-between items-center">
            <span className="truncate mr-2 flex items-center gap-2"><User size={18} className="text-slate-500"/> {user.displayName}</span>
            <button onClick={() => signOut(auth)} className="text-red-500 underline text-xs font-bold tracking-tight">登出</button>
          </div>
          <label className="bg-slate-800 text-white w-full py-3.5 rounded-xl text-center font-black text-lg cursor-pointer hover:bg-black transition-all shadow-lg flex items-center justify-center gap-3">
            <Upload size={22}/> 匯入新回條名單 <input type="file" onChange={handleFileUpload} className="hidden" />
          </label>
          <button onClick={() => toPng(reportRef.current, { backgroundColor: '#ffffff', cacheBust: true, pixelRatio: 2 }).then(u=>{const a=document.createElement('a');a.download=`未繳名單.png`;a.href=u;a.click();})} className="bg-white border-2 border-indigo-800 w-full py-3.5 rounded-xl text-center font-black text-lg text-indigo-900 flex items-center justify-center gap-3 shadow-md hover:bg-indigo-50 active:scale-95 transition-all">
            <Camera size={22}/> 另存未繳報表
          </button>
        </div>

        <div className="flex items-center gap-2 text-slate-700 bg-white/40 px-4 py-1.5 rounded-full border border-slate-500 font-black shadow-inner mt-1">
          <Eye size={14} />
          <span className="text-[10px] tracking-widest uppercase text-slate-600 font-black">Traffic: {visitorCount}</span>
        </div>

        <div className="bg-[#95A3B5] px-10 py-2.5 rounded-xl text-white font-black text-lg shadow-sm border border-slate-300 w-full text-center truncate tracking-tight">
          {activeClass || "---"} 回收進度
        </div>

        <div className="w-[180px] h-[180px] relative bg-[#515964] rounded-full flex items-center justify-center p-5 shadow-2xl border-4 border-[#AEB9C8] flex-none">
          <Doughnut data={{ datasets: [{ data: [doneCount, total - doneCount], backgroundColor: ['#697789', '#3D4650'], borderWidth: 0 }] }} options={{ plugins: { tooltip: { enabled: false } }, maintainAspectRatio: false }} />
          <div className="absolute flex flex-col items-center text-white pointer-events-none">
            <span className="text-5xl font-black italic tracking-tighter">{total > 0 ? Math.round((doneCount/total)*100) : 0}%</span>
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">Done</span>
          </div>
        </div>

        <div className="w-full space-y-2.5 px-4 flex-none font-bold text-slate-800">
          <div className="border border-slate-600 p-3 rounded-xl bg-white/30 flex justify-between items-center shadow-md border-l-8 border-l-emerald-500 transition-all"><span className="text-md">已繳交：</span><span className="text-2xl font-black">{doneCount}</span></div>
          <div className="border border-slate-600 p-3 rounded-xl bg-white/30 flex justify-between items-center shadow-md border-l-8 border-l-red-500 text-red-800 transition-all"><span className="text-md font-black">未繳交：</span><span className="text-2xl font-black">{total - doneCount}</span></div>
        </div>

        <div className="w-full mt-auto">
          <div className="bg-[#5B6B7E]/20 p-4 rounded-xl border border-slate-400/50 w-full flex flex-col items-center gap-1 shadow-inner">
            <ShieldCheck size={20} className="text-[#5B6B7E] opacity-80" />
            <p className="text-[12px] font-black text-slate-800 leading-tight text-center tracking-tighter">國立鳳山高中曾耀毅老師製作與授權使用</p>
            <p className="text-[8px] text-slate-500 font-bold opacity-60 uppercase mt-1 tracking-widest">Education System v5.8 | © 2025</p>
          </div>
        </div>
      </aside>

      {/* 隱藏報表容器 */}
      <div style={{ position: 'absolute', left: '-9999px', top: '0' }}>
        <div ref={reportRef} style={{ width: '800px', padding: '50px', backgroundColor: '#ffffff', fontFamily: 'sans-serif' }}>
          <h2 style={{ textAlign: 'center', fontSize: '32px', marginBottom: '10px', color: '#1e293b', fontWeight: '900' }}>{currentReceiptName} 回條清單</h2>
          <h3 style={{ textAlign: 'center', fontSize: '20px', marginBottom: '30px', color: '#64748b', borderBottom: '3px solid #f1f5f9', paddingBottom: '15px' }}>【{activeClass || '全校'}】未繳交名單統計</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px' }}>
            {unsubmittedStudents.map(s => (
              <div key={s.id} style={{ fontSize: '24px', padding: '12px', borderBottom: '1px solid #f1f5f9', fontWeight: 'bold' }}>
                <span style={{ color: '#cbd5e1', marginRight: '10px', fontSize: '16px' }}>{s.no}</span>
                <span>{s.name}</span>
              </div>
            ))}
          </div>
          {unsubmittedStudents.length === 0 && <p style={{ textAlign: 'center', fontSize: '24px', color: '#10b981', fontWeight: 'bold', marginTop: '50px' }}>全部已繳齊！</p>}
        </div>
      </div>

      {isUploading && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-md flex flex-col items-center justify-center text-white font-bold p-8">
           <Loader2 className="animate-spin mb-4" size={56} />
           <p className="text-xl font-black tracking-widest uppercase italic tracking-tighter">Updating Cloud Database...</p>
        </div>
      )}
    </div>
  );
}

export default App;