import React, { useState, useEffect, useRef, useMemo } from 'react';
import { auth, db, googleProvider } from './firebase'; 
import { signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, query, onSnapshot, doc, updateDoc, writeBatch, getDocs, setDoc, increment, where, deleteDoc, getDoc } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import { LogOut, Upload, Camera, CheckSquare, XSquare, FileText, Loader2, User, ChevronDown, ChevronUp, PencilLine, Eye, ShieldCheck, ListFilter, Trash2, GraduationCap, MapPin, Briefcase, Mail, Coffee } from 'lucide-react';
import { toPng } from 'html-to-image';

ChartJS.register(ArcElement, Tooltip, Legend);

function App() {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [formData, setFormData] = useState({ schoolName: '', region: '台北市', role: '導師' });
  const [allStudents, setAllStudents] = useState([]);
  const [receipts, setReceipts] = useState([]); 
  const [activeReceiptId, setActiveReceiptId] = useState(null); 
  const [visitorCount, setVisitorCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [localTitle, setLocalTitle] = useState(""); 
  const [expandedGrade, setExpandedGrade] = useState("高一");
  const [activeClass, setActiveClass] = useState(null); 
  const reportRef = useRef(null);
  const isFirstLoadRef = useRef(true);

  const regions = ["台北市", "新北市", "桃園市", "台中市", "台南市", "高雄市", "基隆市", "新竹市", "新竹縣", "苗栗國", "彰化縣", "南投縣", "雲林縣", "嘉義市", "嘉義縣", "屏東縣", "宜蘭縣", "花蓮國", "台東縣", "澎湖縣", "金門縣", "馬祖"];

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      try {
        if (u) {
          setUser(u);
          const profileRef = doc(db, "user_profiles", u.uid);
          const profileSnap = await getDoc(profileRef);
          if (profileSnap.exists()) {
            setUserProfile(profileSnap.data());
            setShowOnboarding(false);
          } else { setShowOnboarding(true); }
          const statsRef = doc(db, "system", "stats");
          if (!sessionStorage.getItem('hasVisited')) {
            setDoc(statsRef, { views: increment(1) }, { merge: true }).catch(e => {});
            sessionStorage.setItem('hasVisited', 'true');
          }
          onSnapshot(statsRef, (snap) => snap.exists() && setVisitorCount(snap.data().views || 0));
        } else { setUser(null); }
      } catch (err) { console.error(err); } finally { setLoading(false); }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || showOnboarding) return;
    const q = query(collection(db, "users", user.uid, "receipts"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setReceipts(data);
      if (data.length > 0 && !activeReceiptId) setActiveReceiptId(data[data.length - 1].id);
    });
    return () => unsubscribe();
  }, [user, showOnboarding, activeReceiptId]);

  useEffect(() => {
    if (!user || !activeReceiptId || showOnboarding) { setAllStudents([]); return; }
    const current = receipts.find(r => r.id === activeReceiptId);
    if (current) setLocalTitle(current.name);
    const q = query(collection(db, "users", user.uid, "students"), where("receiptId", "==", activeReceiptId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      data.sort((a, b) => a.class === b.class ? a.no.localeCompare(b.no) : a.class.localeCompare(b.class, 'zh-Hant'));
      setAllStudents(data);
      if (isFirstLoadRef.current && data.length > 0) {
        setActiveClass(data[0].class);
        isFirstLoadRef.current = false;
      }
    });
    return () => unsubscribe();
  }, [user, activeReceiptId, showOnboarding, receipts]);

  const handleUpdateTitle = async (newTitle) => {
    setLocalTitle(newTitle);
    if (activeReceiptId) await updateDoc(doc(db, "users", user.uid, "receipts", activeReceiptId), { name: newTitle });
  };

  const handleGradeClick = (grade) => {
    setExpandedGrade(prev => prev === grade ? null : grade);
    setActiveClass(null);
  };

  const getGradeGroup = (c) => {
    if (!c) return "其他";
    const n = String(c).trim();
    if (/^[123]\d{2}$/.test(n)) {
      if (n.startsWith('1')) return "高一";
      if (n.startsWith('2')) return "高二";
      if (n.startsWith('3')) return "高三";
    }
    return "其他";
  };

  const classList = useMemo(() => [...new Set(allStudents.map(s => s.class))].sort(), [allStudents]);
  const displayStudents = useMemo(() => expandedGrade === "全校" ? allStudents : (activeClass ? allStudents.filter(s => s.class === activeClass) : []), [allStudents, expandedGrade, activeClass]);
  const unsubmittedStudents = displayStudents.filter(s => !s.isDone);
  const doneCount = displayStudents.length - unsubmittedStudents.length;
  const total = displayStudents.length;

  // --- 關鍵修正：直接下載到預設資料夾 (Downloads) ---
  const exportUnsubmittedReport = async () => {
    if (!reportRef.current) return;
    try {
      // 1. 生成圖片
      const dataUrl = await toPng(reportRef.current, { backgroundColor: '#ffffff', cacheBust: true, pixelRatio: 2 });
      
      // 2. 建立檔名：[班級]_[標題]未繳名單_[日期].png
      const dateStr = new Date().toLocaleDateString('zh-TW').replace(/\//g, '_');
      const fileName = `${activeClass || '全校'}_${localTitle}未繳名單_${dateStr}.png`;

      // 3. 觸發標準下載 (這會直接儲存到瀏覽器預設的「下載」資料夾)
      const link = document.createElement('a');
      link.download = fileName;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
    } catch (err) {
      console.error("下載失敗", err);
      alert("下載失敗，請稍後再試。");
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const receiptName = window.prompt("請輸入回條名稱", "新回條");
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
        workbook.SheetNames.forEach(name => {
          XLSX.utils.sheet_to_json(workbook.Sheets[name]).forEach((row, i) => {
            const studentName = String(row['姓名'] || row['學生姓名'] || '未知').trim();
            const studentClass = String(row['班級'] || '').trim();
            let groupLabel = name;
            let finalNo = String(row['座號'] || (i + 1)).padStart(2, '0');
            if (row['社團'] || row['類別']) {
                groupLabel = row['社團'] || row['類別'];
                finalNo = studentClass ? `${studentClass}-${finalNo}` : finalNo;
            } else { groupLabel = studentClass || name; }
            allEntries.push({ receiptId, class: String(groupLabel).trim(), no: finalNo, name: studentName, isDone: false, note: '' });
          });
        });
        for (let i = 0; i < allEntries.length; i += 500) {
          const batch = writeBatch(db);
          allEntries.slice(i, i + 500).forEach((item, j) => batch.set(doc(db, "users", user.uid, "students", `s_${receiptId}_${i + j}`), item));
          await batch.commit();
        }
        setActiveReceiptId(receiptId);
      } catch (err) { alert("上傳失敗"); } finally { setIsUploading(false); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = null;
  };

  const groupedUnsubmitted = useMemo(() => {
    return unsubmittedStudents.reduce((acc, student) => {
      (acc[student.class] = acc[student.class] || []).push(student);
      return acc;
    }, {});
  }, [unsubmittedStudents]);

  if (loading) return <div className="h-screen flex items-center justify-center bg-[#C3CCD8] font-bold">載入中...</div>;

  if (!user) return (
    <div className="h-screen flex items-center justify-center bg-[#C3CCD8]">
      <div className="bg-white p-12 rounded-2xl shadow-2xl text-center border-t-8 border-slate-700">
        <FileText size={64} className="mx-auto text-blue-500 mb-6" />
        <h1 className="text-3xl font-black text-slate-700 mb-8">學生回條回收系統</h1>
        <button onClick={() => signInWithPopup(auth, googleProvider)} className="bg-slate-800 text-white px-10 py-4 rounded-xl font-bold shadow-lg hover:bg-black transition active:scale-95">Google 快速登入</button>
      </div>
    </div>
  );

  if (showOnboarding) return (
    <div className="h-screen w-screen bg-[#C3CCD8] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl p-10 border border-white text-slate-800">
        <form onSubmit={(e) => { e.preventDefault(); if(!formData.schoolName) return alert("請輸入學校"); setIsUploading(true); setDoc(doc(db, "user_profiles", user.uid), { ...formData, email: user.email, displayName: user.displayName, createdAt: Date.now() }).then(() => { setUserProfile(formData); setShowOnboarding(false); }).finally(() => setIsUploading(false)); }} className="space-y-5">
          <div className="text-center mb-6"><h2 className="text-3xl font-black">歡迎使用系統</h2><p className="text-slate-400 font-bold">請填寫基礎資訊以開啟功能</p></div>
          <input required type="text" placeholder="學校全稱" value={formData.schoolName} onChange={(e) => setFormData({...formData, schoolName: e.target.value})} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 font-bold focus:border-blue-500 transition-all" />
          <select value={formData.region} onChange={(e) => setFormData({...formData, region: e.target.value})} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 font-bold outline-none cursor-pointer">
            {regions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-3">{["導師", "行政承辦人"].map(r => (<button type="button" key={r} onClick={() => setFormData({...formData, role: r})} className={`py-4 rounded-2xl font-black text-sm border-2 transition-all ${formData.role === r ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white text-slate-400'}`}>{r}</button>))}</div>
          <button type="submit" className="w-full bg-slate-800 text-white py-5 rounded-[2rem] font-black text-lg hover:bg-black active:scale-95 transition-all">進入系統</button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen w-screen bg-[#C3CCD8] overflow-hidden font-sans text-slate-800 text-sm">
      <main className="flex-1 flex flex-col h-full overflow-hidden p-5 lg:p-6 gap-4">
        <div className="flex-none bg-white border border-slate-400 p-4 lg:p-6 shadow-sm flex items-center justify-center gap-4 rounded-sm">
          <div className="flex items-center justify-center gap-3 w-full max-w-4xl">
            <PencilLine className="text-slate-200 flex-none" size={36} />
            <div className="flex items-center gap-2 overflow-hidden">
              <input type="text" value={localTitle} onChange={(e) => handleUpdateTitle(e.target.value)} placeholder="活動名稱" className="text-4xl lg:text-5xl font-serif text-slate-700 bg-transparent focus:outline-none border-b border-transparent hover:border-slate-200 transition-all text-center min-w-[150px] font-bold" />
              <span className="text-4xl lg:text-5xl font-serif text-slate-700 whitespace-nowrap font-bold text-slate-800">回條清單</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 flex-none no-print">
          <div className="flex gap-2 justify-center items-center">
            {["高一", "高二", "高三", "其他", "全校"].map(g => (
              <button key={g} onClick={() => handleGradeClick(g)} className={`px-8 py-2.5 rounded-xl font-black text-base flex items-center gap-2 transition-all ${expandedGrade === g ? 'bg-[#5B6B7E] text-white shadow-md scale-105' : 'bg-[#95A3B5] text-slate-100'}`}>
                {g} {expandedGrade === g ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
              </button>
            ))}
            <div className="mx-2 h-10 w-[1px] bg-slate-400 opacity-40"></div>
            <div className="flex flex-col gap-1 min-w-[180px]">
              <div className="flex items-center bg-white/60 px-2 py-1 rounded-lg border border-slate-400 shadow-sm">
                <ListFilter size={14} className="text-slate-500 mr-1"/>
                <select value={activeReceiptId || ""} onChange={(e) => {setActiveReceiptId(e.target.value); setActiveClass(null); isFirstLoadRef.current = true;}} className="bg-transparent font-bold text-slate-700 focus:outline-none cursor-pointer text-xs w-full text-center">
                  <option value="" disabled>切換回條...</option>
                  {[...receipts].reverse().map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              {activeReceiptId && (
                <button onClick={() => { if (window.confirm(`確定刪除？`)) { setIsUploading(true); const q = query(collection(db, "users", user.uid, "students"), where("receiptId", "==", activeReceiptId)); getDocs(q).then(s => { const b = writeBatch(db); s.docs.forEach(d => b.delete(d.ref)); return b.commit(); }).then(() => deleteDoc(doc(db, "users", user.uid, "receipts", activeReceiptId))).then(() => { setActiveReceiptId(null); setActiveClass(null); setIsUploading(false); }); } }} className="text-[10px] font-bold text-slate-500 hover:text-red-600 transition flex items-center justify-center gap-1 tracking-tighter"><Trash2 size={10}/> 刪除此份回條及其數據</button>
              )}
            </div>
          </div>
          {expandedGrade && expandedGrade !== "全校" && (
            <div className="p-2.5 bg-[#AEB9C8]/50 rounded-2xl border border-white/20 flex flex-wrap gap-2 justify-center animate-in fade-in slide-in-from-top-2">
              {[...new Set(allStudents.filter(s => getGradeGroup(s.class) === expandedGrade).map(s => s.class))].sort().map(cls => (
                <button key={cls} onClick={() => setActiveClass(cls)} className={`px-5 py-2 rounded-xl text-white font-bold text-sm transition-all ${activeClass === cls ? 'bg-[#5B6B7E] shadow-lg scale-110' : 'bg-[#95A3B5]'}`}>
                  {/^\d+$/.test(cls) ? `${cls} 班` : cls}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar bg-white border border-slate-400 rounded-sm shadow-xl text-slate-800 font-bold">
          {activeReceiptId && (activeClass || expandedGrade === "全校") ? (
            <table className="w-full border-collapse">
              <thead className="bg-[#F2C2C2] sticky top-0 z-20 shadow-sm text-sm font-bold border-b text-slate-700">
                <tr>
                  <th className="p-3 w-20 border-r">班級</th>
                  <th className="p-3 w-24 border-r">座號</th>
                  <th className="p-3 text-left pl-8 border-r">姓名</th>
                  <th className="p-3 w-44 text-center border-r">
                    <div className="flex flex-col items-center gap-1.5 text-xs font-black text-slate-600">
                       <span>繳交狀態</span>
                       <div className="flex gap-2 no-print">
                          <button onClick={() => { if(window.confirm("全交？")) { setIsUploading(true); const b = writeBatch(db); displayStudents.forEach(s => b.update(doc(db, "users", user.uid, "students", s.id), {isDone: true})); b.commit().then(()=>setIsUploading(false)); } }} className="bg-green-600 text-white text-[10px] px-2 py-0.5 rounded shadow-sm tracking-tight">全交</button>
                          <button onClick={() => { if(window.confirm("清空？")) { setIsUploading(true); const b = writeBatch(db); displayStudents.forEach(s => b.update(doc(db, "users", user.uid, "students", s.id), {isDone: false})); b.commit().then(()=>setIsUploading(false)); } }} className="bg-red-600 text-white text-[10px] px-2 py-0.5 rounded shadow-sm tracking-tight">清空</button>
                       </div>
                    </div>
                  </th>
                  <th className="p-3 border-slate-400">備註</th>
                </tr>
              </thead>
              <tbody>
                {displayStudents.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50 border-b border-slate-200 h-11 transition-colors">
                    <td className="text-center font-bold text-slate-500 border-r">{s.class}</td>
                    <td className="text-center font-bold text-slate-400 border-r tracking-tighter">{s.no}</td>
                    <td className={`font-bold pl-8 text-xl border-r ${s.isDone ? 'text-slate-200 font-normal' : 'text-slate-700'}`}>{s.name}</td>
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
                    <td className="p-1.5 border-slate-400"><input type="text" defaultValue={s.note} onBlur={(e) => updateDoc(doc(db, "users", user.uid, "students", s.id), { note: e.target.value })} className="w-full bg-transparent focus:outline-none px-3 text-slate-400 text-sm italic" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-300 font-bold italic text-xl p-10 text-center tracking-tighter">請選取班級名單</div>
          )}
        </div>
      </main>

      <aside className="w-[420px] h-full bg-[#AEB9C8] border-l border-slate-300 p-6 flex flex-col items-center gap-3 shadow-2xl flex-none no-print overflow-hidden text-slate-800">
        <div className="flex flex-col w-full gap-2.5 flex-none">
          <div className="bg-white border border-slate-400 px-4 py-2.5 rounded-xl shadow-md flex justify-between items-center tracking-tight font-black text-slate-700">
            <div className="flex items-center gap-2 overflow-hidden mr-2">
              <User size={18} className="text-slate-500 flex-none"/> 
              <div className="flex flex-col overflow-hidden leading-tight text-sm">
                <span className="truncate">{userProfile?.schoolName || "未設定"}</span>
                <span className="truncate text-[10px] text-slate-400 font-bold">{user?.displayName} 老師</span>
              </div>
            </div>
            <button onClick={() => signOut(auth)} className="text-red-500 underline text-xs font-bold tracking-tight">登出</button>
          </div>
          <label className="bg-slate-800 text-white w-full py-3.5 rounded-xl text-center font-black text-lg cursor-pointer hover:bg-black transition-all shadow-lg flex items-center justify-center gap-3">
            <Upload size={22}/> 匯入新回條名單 <input type="file" onChange={handleFileUpload} className="hidden" />
          </label>
          <button onClick={exportUnsubmittedReport} className="bg-white border-2 border-indigo-800 w-full py-3.5 rounded-xl text-center font-black text-lg text-indigo-900 flex items-center justify-center gap-3 shadow-md hover:bg-indigo-50 active:scale-95 transition-all">
            <Camera size={22}/> 另存未繳名單
          </button>
        </div>

        <div className="flex items-center gap-2 text-slate-700 bg-white/40 px-4 py-1.5 rounded-full border border-slate-500 font-black shadow-inner mt-1">
          <Eye size={14} />
          <span className="text-[10px] tracking-widest uppercase tracking-tight text-slate-600 font-black tracking-widest">Traffic: {visitorCount}</span>
        </div>

        <div className="flex-none w-full bg-[#95A3B5] py-3 rounded-xl text-white font-black text-lg shadow-sm border border-slate-300 text-center truncate tracking-tighter">
          {activeClass || "---"} 回收進度
        </div>

        <div className="w-[180px] h-[180px] relative bg-[#515964] rounded-full flex items-center justify-center p-5 shadow-2xl border-4 border-[#AEB9C8] flex-none">
          <Doughnut data={{ datasets: [{ data: [doneCount, total - doneCount], backgroundColor: ['#697789', '#3D4650'], borderWidth: 0 }] }} options={{ plugins: { tooltip: { enabled: false } }, maintainAspectRatio: false }} />
          <div className="absolute flex flex-col items-center text-white pointer-events-none text-center">
            <span className="text-5xl font-black italic tracking-tighter leading-none">{total > 0 ? Math.round((doneCount/total)*100) : 0}%</span>
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">DONE</span>
          </div>
        </div>

        <div className="w-full space-y-2.5 px-4 flex-none font-bold text-sm">
          <div className="border border-slate-600 p-3 rounded-xl bg-white/30 flex justify-between items-center shadow-md border-l-8 border-l-emerald-500 transition-all font-black text-slate-800"><span className="text-md">已繳交：</span><span className="text-2xl">{doneCount}</span></div>
          <div className="border border-slate-600 p-3 rounded-xl bg-white/30 flex justify-between items-center shadow-md border-l-8 border-l-red-500 text-red-800 transition-all font-black tracking-tighter"><span className="text-md">未繳交：</span><span className="text-2xl">{total - doneCount}</span></div>
        </div>

        <div className="w-full mt-auto flex flex-col items-center">
          <div className="bg-[#5B6B7E]/25 p-4 rounded-2xl border border-white/20 w-full shadow-inner text-slate-800 backdrop-blur-sm">
            <div className="flex flex-row items-center gap-4 w-full">
               <div className="flex-none"><img src="/line-qr.png" alt="Line QR" className="w-[80px] h-[80px] rounded-lg shadow-md mix-blend-multiply opacity-95 grayscale-[5%]" style={{ filter: 'brightness(0.95) contrast(1.1)' }} /></div>
               <div className="flex-grow flex flex-col gap-1.5 overflow-hidden">
                  <p className="text-[10px] font-black leading-tight text-slate-800 tracking-tighter">本網頁由蚵仔囝老師、蒜米老師製作、授權使用</p>
                  <p className="text-[9px] font-bold text-slate-600 leading-tight">使用上有問題或請我喝咖啡，請跟我聯繫</p>
                  <div className="flex flex-col gap-1 mt-0.5">
                    <div className="flex items-center gap-1.5 text-[10px] font-black text-indigo-950 bg-white/40 px-2.5 py-1 rounded-full w-fit shadow-sm truncate font-black"><Mail size={11} className="text-slate-500 flex-none"/> yaoink@gmail.com</div>
                    <div className="flex items-center gap-1.5 text-[10px] font-black text-indigo-950 bg-white/40 px-2.5 py-1 rounded-full w-fit shadow-sm truncate font-black"><Coffee size={11} className="text-slate-500 flex-none"/> Line ID：@056hkncr</div>
                  </div>
               </div>
            </div>
            <p className="text-[8px] text-slate-500 font-bold opacity-50 uppercase mt-2 text-center tracking-widest border-t border-slate-500/10 pt-1 tracking-widest">Education System v7.5 | © 2025</p>
          </div>
        </div>
      </aside>

      {/* 隱藏報表 */}
      <div style={{ position: 'absolute', left: '-9999px', top: '0' }}>
        <div ref={reportRef} style={{ width: '800px', padding: '50px', backgroundColor: '#ffffff', fontFamily: 'sans-serif' }}>
          <h2 style={{ textAlign: 'center', fontSize: '32px', marginBottom: '10px', color: '#1e293b', fontWeight: '900' }}>{localTitle} 未繳名單</h2>
          <h3 style={{ textAlign: 'center', fontSize: '20px', marginBottom: '30px', color: '#64748b', borderBottom: '3px solid #f1f5f9', paddingBottom: '15px' }}>
            報表日期：{new Date().toLocaleString('zh-TW')}
          </h3>
          {Object.keys(groupedUnsubmitted).length > 0 ? Object.keys(groupedUnsubmitted).sort().map(className => (
            <div key={className} style={{ marginBottom: '30px' }}>
              <div style={{ backgroundColor: '#f8fafc', padding: '10px 20px', borderRadius: '10px', borderLeft: '8px solid #64748b', marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '24px', fontWeight: '900', color: '#334155' }}>【{className}】班級名單</span>
                  <span style={{ fontSize: '14px', color: '#94a3b8' }}>小計：{groupedUnsubmitted[className].length} 人未繳</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                {groupedUnsubmitted[className].map(s => (
                  <div key={s.id} style={{ fontSize: '20px', padding: '10px', borderBottom: '1px solid #f1f5f9', fontWeight: 'bold', color: '#334155' }}>
                    <span style={{ color: '#cbd5e1', marginRight: '10px', fontSize: '14px' }}>{s.no.split('-').pop()}</span>
                    <span>{s.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )) : <p style={{ textAlign: 'center', fontSize: '24px', color: '#10b981', fontWeight: 'bold', marginTop: '50px' }}>全部人員皆已繳齊。</p>}
        </div>
      </div>

      {isUploading && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-md flex flex-col items-center justify-center text-white font-bold p-8 text-center">
           <Loader2 className="animate-spin mb-4" size={56} />
           <p className="text-xl font-black tracking-widest uppercase italic">Processing...</p>
        </div>
      )}
    </div>
  );
}

export default App;