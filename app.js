const KEY="masaba_attendance_v1";
const $=id=>document.getElementById(id);
const load=()=>JSON.parse(localStorage.getItem(KEY)||"[]");
const save=x=>localStorage.setItem(KEY,JSON.stringify(x));
const fmt=x=>new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(new Date(x));
let stream=null;

function status(text,ok=true){
  $("status").textContent=text;
  $("status").className="status "+(ok?"ok":"error");
}

function getGPS(){
 return new Promise((resolve,reject)=>{
  if(!navigator.geolocation)return reject(new Error("GPS is not supported."));
  navigator.geolocation.getCurrentPosition(
   p=>resolve({lat:+p.coords.latitude.toFixed(6),lng:+p.coords.longitude.toFixed(6),accuracy:Math.round(p.coords.accuracy)}),
   ()=>reject(new Error("Please allow location/GPS permission.")),
   {enableHighAccuracy:true,timeout:15000,maximumAge:0}
  );
 });
}

async function takePhoto(){
 try{
  stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user"},audio:false});
  $("video").srcObject=stream;$("video").hidden=false;
  await new Promise(r=>setTimeout(r,700));
  const v=$("video"),c=$("canvas");
  c.width=v.videoWidth||640;c.height=v.videoHeight||480;
  c.getContext("2d").drawImage(v,0,0,c.width,c.height);
  const data=c.toDataURL("image/jpeg",.65);
  $("preview").src=data;$("preview").hidden=false;
  stream.getTracks().forEach(t=>t.stop());stream=null;$("video").hidden=true;
  return data;
 }catch(e){throw new Error("Please allow camera permission.");}
}

async function mark(type){
 const name=$("employeeName").value.trim();
 if(!name)return status("Enter the employee name first.",false);
 status("Getting GPS and camera permission…");
 try{
  const gps=await getGPS();
  const photo=await takePhoto();
  const records=load();
  const time=new Date().toISOString();
  const open=[...records].reverse().find(r=>r.name.toLowerCase()===name.toLowerCase()&&!r.out);

  if(type==="in"){
   if(open)return status("This employee is already signed in.",false);
   records.push({id:String(Date.now()),name,in:time,inGps:gps,inPhoto:photo,out:null,outGps:null,outPhoto:null,hours:null});
  }else{
   if(!open)return status("No open sign-in was found for this employee.",false);
   open.out=time;open.outGps=gps;open.outPhoto=photo;
   open.hours=((new Date(time)-new Date(open.in))/3600000).toFixed(2);
  }
  save(records);
  status(`${type==="in"?"Sign in":"Sign out"} successful — ${fmt(time)}`);
  renderMy();
 }catch(e){status(e.message,false)}
}

function renderMy(){
 const name=$("employeeName").value.trim().toLowerCase();
 if(!name){$("myHistory").innerHTML="<p>Enter your name to see records.</p>";return}
 const rows=load().filter(r=>r.name.toLowerCase()===name).reverse();
 $("myHistory").innerHTML=rows.length?
 `<div class="tableWrap"><table><tr><th>Date</th><th>Sign in</th><th>Sign out</th><th>Hours</th></tr>
 ${rows.map(r=>`<tr><td>${new Date(r.in).toLocaleDateString()}</td><td>${fmt(r.in)}</td><td>${r.out?fmt(r.out):"—"}</td><td>${r.hours||"Open"}</td></tr>`).join("")}
 </table></div>`:"<p>No attendance records yet.</p>";
}

function renderAdmin(){
 const date=$("filterDate").value;
 const all=load();
 const rows=all.filter(r=>!date||r.in.slice(0,10)===date).reverse();
 const total=rows.reduce((s,r)=>s+Number(r.hours||0),0);
 $("stats").innerHTML=`<div class="stat"><small>Records</small><b>${rows.length}</b></div>
 <div class="stat"><small>Completed</small><b>${rows.filter(r=>r.out).length}</b></div>
 <div class="stat"><small>Total hours</small><b>${total.toFixed(2)}</b></div>`;
 $("adminTable").innerHTML=rows.length?
 `<div class="tableWrap"><table><tr><th>Employee</th><th>Sign in</th><th>Sign out</th><th>Hours</th><th>GPS</th></tr>
 ${rows.map(r=>`<tr><td>${r.name}</td><td>${fmt(r.in)}</td><td>${r.out?fmt(r.out):"—"}</td><td>${r.hours||"Open"}</td><td>${r.inGps.lat}, ${r.inGps.lng}</td></tr>`).join("")}
 </table></div>`:"<p>No records.</p>";
}

$("signInBtn").onclick=()=>mark("in");
$("signOutBtn").onclick=()=>mark("out");
$("employeeName").oninput=renderMy;
$("adminBtn").onclick=()=>$("adminModal").hidden=false;
$("cancelAdmin").onclick=()=>$("adminModal").hidden=true;
$("loginAdmin").onclick=()=>{
 if($("adminPin").value==="1234"){
  $("adminModal").hidden=true;$("employeeView").hidden=true;$("adminView").hidden=false;renderAdmin();
 }else alert("Incorrect PIN");
};
$("backBtn").onclick=()=>{$("adminView").hidden=true;$("employeeView").hidden=false};
$("filterDate").onchange=renderAdmin;
$("clearBtn").onclick=()=>{
 if(confirm("Delete all attendance records on this device?")){
  localStorage.removeItem(KEY);renderAdmin();renderMy();
 }
};
$("exportBtn").onclick=()=>{
 const rows=load();
 const head=["Employee","Sign In","Sign Out","Hours","In Latitude","In Longitude","Out Latitude","Out Longitude"];
 const csv=[head,...rows.map(r=>[r.name,r.in,r.out||"",r.hours||"",r.inGps?.lat||"",r.inGps?.lng||"",r.outGps?.lat||"",r.outGps?.lng||""])]
 .map(a=>a.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");
 const blob=new Blob([csv],{type:"text/csv"});
 const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="masaba-attendance.csv";a.click();
};
renderMy();
