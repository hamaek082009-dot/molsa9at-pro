let prices=[], selected={};
const $=s=>document.querySelector(s);
const money=n=>Number(n).toLocaleString("ar-DZ")+" دج";
let appliedOffer = null;
try {
  const savedOffer = localStorage.getItem("molsaqat_applied_offer");
  appliedOffer = savedOffer ? JSON.parse(savedOffer) : null;
} catch {
  localStorage.removeItem("molsaqat_applied_offer");
}

function applyOffer(offer){
  if(!offer?.code) return;
  appliedOffer={
    code:String(offer.code).toUpperCase(),
    discountType:offer.discountType==="fixed"?"fixed":"percent",
    discountValue:Number(offer.discountValue)||0,
    minTotal:Number(offer.minTotal)||0
  };
  localStorage.setItem("molsaqat_applied_offer",JSON.stringify(appliedOffer));
  if($("#offerCode")) $("#offerCode").value=appliedOffer.code;
  renderAppliedOffer();
  updateTotal();
  $("#offerBox")?.scrollIntoView({behavior:"smooth",block:"center"});
  if(typeof toast==="function") toast("تم وضع العرض وتطبيقه تلقائياً: "+appliedOffer.code);
}
function clearOffer(){
  appliedOffer=null;
  localStorage.removeItem("molsaqat_applied_offer");
  if($("#offerCode")) $("#offerCode").value="";
  renderAppliedOffer();
  updateTotal();
}

async function loadNotifications(){
  try{
    const list=await fetch("/api/notifications").then(r=>r.json());
    const hidden=JSON.parse(localStorage.getItem("molsaqat_hidden_notifications")||"[]");
    $("#notifications").innerHTML=list.filter(n=>!hidden.includes(n.id)).map(n=>`
      <div class="notice ${n.type||"offer"} ${n.offer?.code?"clickable-offer":""}" data-id="${n.id}"
        ${n.offer?.code?`onclick="applyOffer(${JSON.stringify(n.offer).replace(/"/g,"&quot;")})"`:""}>
        <span class="notice-icon">${n.type==="warning"?"⚠️":n.type==="info"?"ℹ️":"🏷️"}</span>
        <div>
          <b>${esc(n.title)}</b>
          <small>${esc(n.message)}${n.expiresAt?" · ينتهي "+new Date(n.expiresAt).toLocaleDateString("ar-DZ"):""}</small>
          ${n.offer?.code?`<small class="offer-hint">اضغط هنا لتطبيق العرض · ${esc(n.offer.code)}</small>`:""}
        </div>
        <button class="notice-close" onclick="event.stopPropagation();hideNotice('${n.id}')">×</button>
      </div>`).join("");
  }catch{}
}

function calculateDiscountedTotal(subtotal){
  if(!appliedOffer) return {discount:0,total:subtotal,valid:true};
  if(appliedOffer.minTotal && subtotal < appliedOffer.minTotal)
    return {discount:0,total:subtotal,valid:false};
  const discount=appliedOffer.discountType==="fixed"
    ? Math.min(subtotal,appliedOffer.discountValue)
    : Math.min(subtotal,subtotal*appliedOffer.discountValue/100);
  return {discount,total:Math.max(0,subtotal-discount),valid:true};
}
function renderAppliedOffer(){
  const box=$("#offerBox"), status=$("#offerStatus");
  if(!box||!status) return;
  if(!appliedOffer){
    box.classList.remove("offer-applied");
    status.textContent="لا يوجد عرض مطبق حالياً";
    status.className="offer-status";
    return;
  }
  box.classList.add("offer-applied");
  status.textContent=`العرض ${appliedOffer.code} محدد وسيُطبق عند إرسال الطلب`;
  status.className="offer-status success";
}

function hideNotice(id){
  const hidden=JSON.parse(localStorage.getItem("molsaqat_hidden_notifications")||"[]");
  hidden.push(id);localStorage.setItem("molsaqat_hidden_notifications",JSON.stringify(hidden));
  const el=document.querySelector('.notice[data-id="'+id+'"]');if(el)el.remove();
}
function esc(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
async function init(){
  try{
    const res=await fetch("/api/prices");
    if(!res.ok) throw new Error("تعذر تحميل الأسعار");
    prices=await res.json();
    renderProducts();
    updateTotal();
  }catch(err){
    console.error("Initialization error:",err);
    if($("#products")) $("#products").innerHTML='<p class="muted">تعذر تحميل المنتجات. أعد تحميل الصفحة.</p>';
    toast("تعذر تحميل المنتجات. أعد تحميل الصفحة.");
  }
}
function renderProducts(){
  $("#products").innerHTML=prices.map(p=>`<div class="product" data-id="${p.id}">
    <button type="button" class="qty-btn minus">−</button><b class="qty">0</b><button type="button" class="qty-btn plus">+</button>
    <div class="ptext"><strong>${p.name}</strong><small>${money(p.price)} / القطعة</small></div><i>${p.icon}</i>
  </div>`).join("");
  document.querySelectorAll(".product").forEach(el=>{
    const id=el.dataset.id;selected[id]=0;
    el.querySelector(".plus").onclick=()=>{selected[id]++;updateProduct(el,id)};
    el.querySelector(".minus").onclick=()=>{selected[id]=Math.max(0,selected[id]-1);updateProduct(el,id)};
  });
}
function updateProduct(el,id){el.querySelector(".qty").textContent=selected[id];updateTotal()}
function updateTotal(){
  const subtotal=prices.reduce((s,p)=>s+(selected[p.id]||0)*p.price,0);
  const result=calculateDiscountedTotal(subtotal);
  $("#total").textContent=money(result.total);
  $("#submitTotal").textContent=money(result.total);
  const dl=$("#discountLine");
  if(result.discount>0){
    dl.hidden=false;
    $("#discount").textContent="- "+money(result.discount);
  }else{
    dl.hidden=true;
  }
  if(appliedOffer && !result.valid){
    $("#offerStatus").textContent=`العرض ${appliedOffer.code} يحتاج إلى حد أدنى ${money(appliedOffer.minTotal)}`;
    $("#offerStatus").className="offer-status warning";
  }else{
    renderAppliedOffer();
  }
  return result.total;
}

$("#images").addEventListener("change",preview);
function preview(){
  const files=[...$("#images").files];$("#preview").innerHTML="";
  files.forEach(f=>{const img=document.createElement("img");img.src=URL.createObjectURL(f);$("#preview").appendChild(img)});
}
$("#drop").addEventListener("dragover",e=>{e.preventDefault();$("#drop").style.borderColor="#3289f5"});
$("#drop").addEventListener("dragleave",()=>$("#drop").style.borderColor="");
$("#drop").addEventListener("drop",e=>{e.preventDefault();$("#drop").style.borderColor="";$("#images").files=e.dataTransfer.files;preview()});
$("#applyOfferBtn").addEventListener("click",async()=>{
  const code=$("#offerCode").value.trim().toUpperCase();
  if(!code){clearOffer();return toast("اكتب كود العرض");}
  try{
    const offers=await fetch("/api/notifications").then(r=>r.json());
    const found=offers.find(n=>n.offer?.code===code);
    if(!found) return toast("كود العرض غير صحيح أو منتهي");
    applyOffer(found.offer);
  }catch{toast("تعذر التحقق من العرض")}
});
$("#clearOfferBtn").addEventListener("click",clearOffer);
$("#offerCode").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();$("#applyOfferBtn").click()}});

$("#orderForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const total=updateTotal();
  if(total===0)return toast("اختر نوعاً واحداً على الأقل");

  const form=e.target;
  const submitBtn=form.querySelector("button[type=submit]");
  const originalText=submitBtn?.innerHTML || "إرسال الطلب";
  if(submitBtn){
    submitBtn.disabled=true;
    submitBtn.innerHTML='<span>جاري إرسال الطلب...</span>';
  }

  try{
    const fd=new FormData(form);
    fd.set("items",JSON.stringify(prices.filter(p=>selected[p.id]).map(p=>({
      id:p.id,name:p.name,qty:selected[p.id]
    }))));
    if(appliedOffer) fd.set("offerCode",appliedOffer.code);

    const res=await fetch("/api/orders",{method:"POST",body:fd});
    const contentType=res.headers.get("content-type")||"";
    const data=contentType.includes("application/json") ? await res.json() : {error:await res.text()};

    if(!res.ok) throw new Error(data.error||`تعذر إرسال الطلب (${res.status})`);
    if(!data.order?.number) throw new Error("تمت الاستجابة لكن لم يصل رقم الطلب");

    location.href="/?success="+encodeURIComponent(data.order.number);
  }catch(err){
    console.error("Order submission error:",err);
    toast(err.message||"تعذر إرسال الطلب. حاول مرة أخرى.");
  }finally{
    if(submitBtn){
      submitBtn.disabled=false;
      submitBtn.innerHTML=originalText;
    }
  }
});
const params=new URLSearchParams(location.search);
if(params.get("success")) setTimeout(()=>toast("تم استلام طلبك رقم "+params.get("success")+" ✓"),150);
function toast(m){const t=$("#toast");t.textContent=m;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2800)}
init(); loadNotifications(); if(appliedOffer && $("#offerCode")) $("#offerCode").value=appliedOffer.code; renderAppliedOffer(); window.addEventListener('molsaqat:offer',renderAppliedOffer);

window.applyOffer=applyOffer; window.hideNotice=hideNotice;
