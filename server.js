const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const DB_FILE = path.join(DATA_DIR, "db.json");

fs.mkdirSync(DATA_DIR, {recursive:true});
fs.mkdirSync(UPLOAD_DIR, {recursive:true});

const defaultDb = {
  prices: [
    {id:"small", name:"صورة صغيرة", price:20, icon:"🏷️", color:"blue"},
    {id:"medium", name:"صورة متوسطة", price:30, icon:"🏷️", color:"purple"},
    {id:"large", name:"صورة كبيرة", price:50, icon:"📌", color:"orange"},
    {id:"bulk9", name:"9 صور صغيرة (بالجملة)", price:125, icon:"📦", color:"green"}
  ],
  orders: [],
  customers: [],
  notifications: []
};

function readDb(){
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb,null,2));
    return structuredClone(defaultDb);
  }
}
function writeDb(db){ fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2)); }
if(!fs.existsSync(DB_FILE)) writeDb(defaultDb);
else {
  const db = readDb();
  let changed = false;
  if(!Array.isArray(db.prices)) { db.prices = defaultDb.prices; changed = true; }
  if(!Array.isArray(db.orders)) { db.orders = []; changed = true; }
  if(!Array.isArray(db.customers)) { db.customers = []; changed = true; }
  if(!Array.isArray(db.notifications)) { db.notifications = []; changed = true; }
  if(changed) writeDb(db);
}

app.use(express.json({limit:"2mb"}));
app.use(express.urlencoded({extended:true}));
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname,"public")));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_,__,cb)=>cb(null,UPLOAD_DIR),
    filename: (_,file,cb)=>{
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, crypto.randomUUID()+ext);
    }
  }),
  limits:{files:30,fileSize:8*1024*1024},
  fileFilter:(_,file,cb)=>{
    cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype));
  }
});

function clean(s,max=200){ return String(s||"").trim().slice(0,max); }
function isAdmin(req){
  const token=req.headers["x-admin-token"] || req.cookies?.admin_token;
  return token && token === crypto.createHmac("sha256",ADMIN_PASSWORD).update("molsaqat-admin").digest("hex");
}
function adminOnly(req,res,next){
  if(!isAdmin(req)) return res.status(401).json({error:"غير مصرح"});
  next();
}
function orderNumber(){
  return "MP-"+new Date().getFullYear()+"-"+String(Date.now()).slice(-7);
}

app.get("/api/prices",(req,res)=>res.json(readDb().prices));

app.get("/api/notifications",(req,res)=>{
  const db=readDb();
  const now=Date.now();
  const active=db.notifications
    .filter(n=>n.active!==false)
    .filter(n=>!n.expiresAt || new Date(n.expiresAt).getTime()>=now)
    .sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  res.json(active);
});

app.post("/api/orders", upload.array("images",30), (req,res)=>{
  const db=readDb();
  let items=[];
  try { items=JSON.parse(req.body.items||"[]"); } catch {}
  if(!clean(req.body.name)) return res.status(400).json({error:"الاسم مطلوب"});
  if(!Array.isArray(items) || !items.length) return res.status(400).json({error:"اختر كمية واحدة على الأقل"});

  const prices=Object.fromEntries(db.prices.map(p=>[p.id,p]));
  const normalized=items.map(i=>({
    id: clean(i.id,50),
    name: clean(i.name,80),
    qty: Math.max(0,Number(i.qty)||0),
    price: prices[i.id]?.price ?? (Number(i.price) || 0)
  })).filter(i=>i.qty>0);

  if(!normalized.length) return res.status(400).json({error:"الكمية غير صحيحة"});
  const subtotal=normalized.reduce((s,i)=>s+i.qty*i.price,0);
  let total=subtotal;
  let discount=0;
  let appliedOffer=null;
  const offerCode=clean(req.body.offerCode,40).toUpperCase();
  if(offerCode){
    const now=Date.now();
    const offerNotice=(db.notifications||[]).find(n =>
      n.active!==false &&
      n.offer?.code===offerCode &&
      (!n.expiresAt || new Date(n.expiresAt).getTime()>=now)
    );
    if(offerNotice){
      const o=offerNotice.offer;
      if(!o.minTotal || subtotal>=Number(o.minTotal)){
        discount=o.discountType==="fixed"
          ? Math.min(subtotal,Number(o.discountValue)||0)
          : Math.min(subtotal,subtotal*(Number(o.discountValue)||0)/100);
        total=Math.max(0,subtotal-discount);
        appliedOffer={
          code:o.code,
          title:offerNotice.title,
          discountType:o.discountType,
          discountValue:Number(o.discountValue)||0,
          minTotal:Number(o.minTotal)||0
        };
      }
    }
  }
  const files=(req.files||[]).map(f=>({name:f.originalname,path:"/uploads/"+f.filename}));

  const order={
    id: crypto.randomUUID(),
    number: orderNumber(),
    name: clean(req.body.name),
    phone: clean(req.body.phone,30),
    items: normalized,
    images: files,
    notes: clean(req.body.notes,1000),
    subtotal,
    discount,
    total,
    offer:appliedOffer,
    status:"قيد الانتظار",
    createdAt:new Date().toISOString(),
    updatedAt:new Date().toISOString()
  };
  db.orders.unshift(order);

  const key=order.phone || order.name.toLowerCase();
  let customer=db.customers.find(c=>c.key===key);
  if(!customer){
    customer={key,name:order.name,phone:order.phone,orders:0,total:0,createdAt:order.createdAt};
    db.customers.push(customer);
  }
  customer.name=order.name; customer.phone=order.phone; customer.orders++; customer.total+=total;
  writeDb(db);
  res.json({ok:true,order});
});

app.get("/api/orders/:number",(req,res)=>{
  const db=readDb();
  const o=db.orders.find(x=>x.number===req.params.number);
  if(!o) return res.status(404).json({error:"الطلب غير موجود"});
  res.json(o);
});

app.post("/api/admin/login",(req,res)=>{
  const password=String(req.body.password||"");
  if(password!==ADMIN_PASSWORD) return res.status(401).json({error:"كلمة المرور غير صحيحة"});
  const token=crypto.createHmac("sha256",ADMIN_PASSWORD).update("molsaqat-admin").digest("hex");
  res.json({ok:true,token});
});

app.get("/api/admin/summary",adminOnly,(req,res)=>{
  const db=readDb();
  const revenue=db.orders.reduce((s,o)=>s+o.total,0);
  const labels=db.orders.reduce((s,o)=>s+o.items.reduce((x,i)=>x+i.qty,0),0);
  res.json({
    totalOrders:db.orders.length,
    pending:db.orders.filter(o=>o.status==="قيد الانتظار").length,
    printing:db.orders.filter(o=>o.status==="قيد الطباعة").length,
    completed:db.orders.filter(o=>o.status==="مكتمل").length,
    customers:db.customers.length,
    revenue, labels
  });
});
app.get("/api/admin/orders",adminOnly,(req,res)=>res.json(readDb().orders));
app.get("/api/admin/customers",adminOnly,(req,res)=>res.json(readDb().customers));

app.patch("/api/admin/orders/:id",adminOnly,(req,res)=>{
  const db=readDb();
  const o=db.orders.find(x=>x.id===req.params.id);
  if(!o) return res.status(404).json({error:"الطلب غير موجود"});
  const allowed=["قيد الانتظار","قيد الطباعة","مكتمل","ملغى"];
  if(allowed.includes(req.body.status)) o.status=req.body.status;
  o.updatedAt=new Date().toISOString();
  writeDb(db);
  res.json(o);
});

app.put("/api/admin/prices",adminOnly,(req,res)=>{
  const db=readDb();
  if(!Array.isArray(req.body.prices)) return res.status(400).json({error:"بيانات غير صحيحة"});
  db.prices=req.body.prices.map(p=>({
    id:clean(p.id,50),name:clean(p.name,80),price:Math.max(0,Number(p.price)||0),
    icon:clean(p.icon,4),color:clean(p.color,20)
  }));
  writeDb(db); res.json(db.prices);
});

app.post("/api/admin/prices",adminOnly,(req,res)=>{
  const db=readDb();
  const name=clean(req.body.name,80);
  const price=Math.max(0,Number(req.body.price)||0);
  if(!name) return res.status(400).json({error:"اسم المنتج مطلوب"});
  const product={
    id:crypto.randomUUID(),
    name,
    price,
    icon:clean(req.body.icon,4)||"🏷️",
    color:clean(req.body.color,20)||"blue"
  };
  db.prices.push(product);
  writeDb(db);
  res.json(product);
});

app.delete("/api/admin/prices/:id",adminOnly,(req,res)=>{
  const db=readDb();
  const index=db.prices.findIndex(p=>p.id===req.params.id);
  if(index<0) return res.status(404).json({error:"المنتج غير موجود"});
  db.prices.splice(index,1);
  writeDb(db);
  res.json({ok:true});
});

app.get("/api/admin/notifications",adminOnly,(req,res)=>{
  res.json(readDb().notifications || []);
});

app.post("/api/admin/notifications",adminOnly,(req,res)=>{
  const db=readDb();
  const title=clean(req.body.title,100);
  const message=clean(req.body.message,500);
  if(!title || !message) return res.status(400).json({error:"العنوان والرسالة مطلوبان"});
  const n={
    id:crypto.randomUUID(),
    title,
    message,
    type:["offer","info","warning"].includes(req.body.type)?req.body.type:"offer",
    active:req.body.active!==false,
    expiresAt:req.body.expiresAt ? new Date(req.body.expiresAt).toISOString() : null,
    offer: req.body.offer ? {
      code: clean(req.body.offer.code, 40).toUpperCase(),
      discountType: req.body.offer.discountType==="fixed" ? "fixed" : "percent",
      discountValue: Math.max(0, Number(req.body.offer.discountValue)||0),
      minTotal: Math.max(0, Number(req.body.offer.minTotal)||0)
    } : null,
    createdAt:new Date().toISOString()
  };
  db.notifications.unshift(n);
  writeDb(db);
  res.json(n);
});

app.patch("/api/admin/notifications/:id",adminOnly,(req,res)=>{
  const db=readDb();
  const n=db.notifications.find(x=>x.id===req.params.id);
  if(!n) return res.status(404).json({error:"الإشعار غير موجود"});
  if(typeof req.body.active==="boolean") n.active=req.body.active;
  if(req.body.title!==undefined) n.title=clean(req.body.title,100);
  if(req.body.message!==undefined) n.message=clean(req.body.message,500);
  if(req.body.type!==undefined && ["offer","info","warning"].includes(req.body.type)) n.type=req.body.type;
  if(req.body.offer!==undefined) n.offer = req.body.offer ? {
    code: clean(req.body.offer.code, 40).toUpperCase(),
    discountType: req.body.offer.discountType==="fixed" ? "fixed" : "percent",
    discountValue: Math.max(0, Number(req.body.offer.discountValue)||0),
    minTotal: Math.max(0, Number(req.body.offer.minTotal)||0)
  } : null;
  writeDb(db);
  res.json(n);
});

app.delete("/api/admin/notifications/:id",adminOnly,(req,res)=>{
  const db=readDb();
  const index=db.notifications.findIndex(x=>x.id===req.params.id);
  if(index<0) return res.status(404).json({error:"الإشعار غير موجود"});
  db.notifications.splice(index,1);
  writeDb(db);
  res.json({ok:true});
});

app.delete("/api/admin/orders/:id",adminOnly,(req,res)=>{
  const db=readDb(); const index=db.orders.findIndex(o=>o.id===req.params.id);
  if(index<0) return res.status(404).json({error:"غير موجود"});
  db.orders.splice(index,1); writeDb(db); res.json({ok:true});
});

app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"public","admin.html")));
app.get("*splat",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

app.listen(PORT,()=>console.log(`ملصقات برو يعمل على http://localhost:${PORT}`));
