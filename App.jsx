import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { sbSignIn, sbSignOut, sbGetUser, dbGet, dbSet, resizeAndUpload, deletePhoto } from './supabase.js'

// ─── CONSTANTS & UTILS ────────────────────────────────────────────────────────
// ── STORAGE KEYS ─────────────────────────────────────────────────────────────
const SK = {
  props:'km3_props', rooms:'km3_rooms', tenants:'km3_tenants',
  invoices:'km3_invoices', expenses:'km3_expenses', charges:'km3_charges',
  maint:'km3_maint', meters:'km3_meters', settings:'km3_settings'
}

// ── UTILS ────────────────────────────────────────────────────────────────────
const uid       = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7)
const todayStr  = () => new Date().toISOString().split('T')[0]
const nowMonth  = () => new Date().toISOString().slice(0,7)
const fmt       = n  => 'Rp ' + Number(n||0).toLocaleString('id-ID')
const short     = n  => {
  const v = Number(n||0)
  if(Math.abs(v)>=1e9) return 'Rp '+(v/1e9).toFixed(1)+'M'
  if(Math.abs(v)>=1e6) return 'Rp '+(v/1e6).toFixed(1)+'jt'
  if(Math.abs(v)>=1e3) return 'Rp '+(v/1e3).toFixed(0)+'rb'
  return fmt(v)
}
const mLabel    = m  => {
  if(!m) return ''
  const [y,mo] = m.split('-')
  return `${['','Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'][+mo]} ${y}`
}
const dLeft     = d  => { if(!d) return 9999; return Math.ceil((new Date(d)-new Date())/864e5) }
const fmtPhone  = p  => (p||'').replace(/\D/g,'').replace(/^0/,'62')
const waUrl     = (phone,msg) => `https://wa.me/${fmtPhone(phone)}?text=${encodeURIComponent(msg)}`
const csvEsc    = s  => typeof s==='string' ? `"${s.replace(/"/g,'""')}"` : s
const clamp     = (n,min,max) => Math.min(max,Math.max(min,n))
const isValidDate = d => d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d))

// ── LOOKUP TABLES ─────────────────────────────────────────────────────────────
const PAY_METHODS   = ['Transfer BCA','Transfer Mandiri','Transfer BRI','Transfer BNI','Transfer BSI','QRIS','GoPay','OVO','Dana','ShopeePay','Cash','Virtual Account','Indomaret/Alfamart']
const EXPENSE_CATS  = ['Listrik','Air (PDAM)','Internet/WiFi','Keamanan','Kebersihan','Perawatan','Perbaikan','Pajak','Asuransi','Gaji Pegawai','Lainnya']
const MAINT_CATS    = ['AC','Listrik','Air/Pipa','Pintu/Kunci','Jendela','Kamar Mandi','Lantai/Dinding','Atap','Furnitur','Internet/WiFi','Lainnya']
const FACILITIES    = ['AC','WiFi','Kasur','Lemari','Meja Belajar','Kursi','Kulkas','TV','Dapur','KM Dalam','KM Luar','Balkon','Water Heater','Mesin Cuci','Parkir Motor','Parkir Mobil','Dispenser','Meja Makan','CCTV','Kunci Digital']
const PERIOD_LBL    = { daily:'Harian', weekly:'Mingguan', monthly:'Bulanan', yearly:'Tahunan' }
const STAFF_ROLES   = { owner:'Pemilik', manager:'Manajer', staff:'Staf' }
const ROOM_STATUS_LABEL = { vacant:'Kosong', occupied:'Terisi', maintenance:'Maintenance', dirty:'Perlu Dibersihkan' }
const DEFAULT_SETTINGS = { gsheetUrl:'', scriptSecret:'', fonnteToken:'', testPhone:'', autoRemindDay:5, visionKey:'', reminderEnabled:false, reminderHour:8, claudeKey:'', anomalyEnabled:true, dailySummaryEnabled:true }

// ── WA HELPERS ────────────────────────────────────────────────────────────────
const sendFonnte = async (token, phone, message) => {
  try {
    const r = await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      headers: { Authorization: token },
      body: new URLSearchParams({ target:fmtPhone(phone), message, delay:'2', countryCode:'62' })
    })
    return r.ok
  } catch(e) { return false }
}

// ── SEED DATA ─────────────────────────────────────────────────────────────────
const SEED = {
  props:[
    {id:'p1',name:'Kos Mawar Indah',type:'kos',address:'Jl. Mawar No. 12, Denpasar',city:'Denpasar',phone:'08123456789',description:'Kos nyaman dekat kampus UNUD.',bankName:'BCA',bankAccount:'1234567890',bankHolder:'Ahmad Pemilik',color:'#4f46e5',tariffKwh:1500,createdAt:'2024-01-01'},
    {id:'p2',name:'Apartemen Green Valley',type:'apartemen',address:'Jl. Sunset Road 88, Kuta',city:'Kuta',phone:'08198765432',description:'Apartemen modern view sawah.',bankName:'Mandiri',bankAccount:'0987654321',bankHolder:'Ahmad Pemilik',color:'#0d9488',tariffKwh:1500,createdAt:'2024-02-01'}
  ],
  rooms:[
    {id:'r1',propertyId:'p1',number:'A-01',floor:1,type:'Standard',size:'4×4m',gender:'campur',pricingPeriods:{daily:80000,weekly:500000,monthly:1200000,yearly:13000000},status:'occupied',facilities:['AC','WiFi','Kasur','Lemari','Meja Belajar'],maxTenants:1,photos:[],notes:'',createdAt:'2024-01-01'},
    {id:'r2',propertyId:'p1',number:'A-02',floor:1,type:'Standard',size:'4×4m',gender:'putri',pricingPeriods:{daily:80000,weekly:500000,monthly:1200000,yearly:13000000},status:'occupied',facilities:['AC','WiFi','Kasur','Lemari'],maxTenants:1,photos:[],notes:'',createdAt:'2024-01-01'},
    {id:'r3',propertyId:'p1',number:'B-01',floor:2,type:'Deluxe',size:'4×6m',gender:'campur',pricingPeriods:{daily:120000,weekly:750000,monthly:1800000,yearly:20000000},status:'vacant',facilities:['AC','WiFi','Kasur','Lemari','Kulkas','TV'],maxTenants:2,photos:[],notes:'',createdAt:'2024-01-01'},
    {id:'r4',propertyId:'p2',number:'Unit-101',floor:1,type:'Studio',size:'25m²',gender:'campur',pricingPeriods:{daily:250000,weekly:1500000,monthly:3500000,yearly:38000000},status:'occupied',facilities:['AC','WiFi','Dapur','KM Dalam','Balkon'],maxTenants:2,photos:[],notes:'',createdAt:'2024-02-01'},
    {id:'r5',propertyId:'p2',number:'Unit-201',floor:2,type:'1 Bedroom',size:'40m²',gender:'campur',pricingPeriods:{daily:350000,weekly:2000000,monthly:5000000,yearly:55000000},status:'vacant',facilities:['AC','WiFi','Dapur','KM Dalam','Balkon','TV','Kulkas'],maxTenants:2,photos:[],notes:'',createdAt:'2024-02-01'}
  ],
  tenants:[
    {id:'t1',propertyId:'p1',roomId:'r1',name:'Budi Santoso',phone:'081234567890',email:'budi@email.com',idNumber:'3171012345670001',gender:'Laki-laki',occupation:'Mahasiswa',emergencyContact:'Siti - 081300000001',checkInDate:'2025-01-05',checkOutDate:'2026-04-30',rentPeriod:'monthly',rentAmount:1200000,depositAmount:2400000,depositReturned:0,status:'active',notes:'Bayar via transfer BCA',createdAt:'2025-01-05'},
    {id:'t2',propertyId:'p1',roomId:'r2',name:'Dewi Rahayu',phone:'081398765432',email:'dewi@email.com',idNumber:'3171012345670002',gender:'Perempuan',occupation:'Karyawan Swasta',emergencyContact:'Agus - 081200000002',checkInDate:'2025-03-01',checkOutDate:'2026-05-31',rentPeriod:'monthly',rentAmount:1200000,depositAmount:2400000,depositReturned:0,status:'active',notes:'',createdAt:'2025-03-01'},
    {id:'t3',propertyId:'p2',roomId:'r4',name:'Ahmad Fauzi',phone:'085712345678',email:'ahmad@email.com',idNumber:'3171012345670003',gender:'Laki-laki',occupation:'Freelancer',emergencyContact:'Fatimah - 085600000003',checkInDate:'2025-06-01',checkOutDate:'2026-09-30',rentPeriod:'monthly',rentAmount:3500000,depositAmount:7000000,depositReturned:0,status:'active',notes:'Bayar via QRIS',createdAt:'2025-06-01'}
  ],
  invoices:[
    {id:'i1',invNo:'INV-202603-1001',tenantId:'t1',roomId:'r1',propertyId:'p1',items:[{desc:'Sewa A-01 - Mar 2026',qty:1,unitPrice:1200000,amount:1200000}],totalAmount:1200000,month:'2026-03',dueDate:'2026-03-05',paidDate:'2026-03-03',status:'paid',paymentMethod:'Transfer BCA',notes:'',createdAt:'2026-03-01'},
    {id:'i2',invNo:'INV-202603-1002',tenantId:'t2',roomId:'r2',propertyId:'p1',items:[{desc:'Sewa A-02 - Mar 2026',qty:1,unitPrice:1200000,amount:1200000}],totalAmount:1200000,month:'2026-03',dueDate:'2026-03-05',paidDate:null,status:'overdue',paymentMethod:null,notes:'',createdAt:'2026-03-01'},
    {id:'i3',invNo:'INV-202603-1003',tenantId:'t3',roomId:'r4',propertyId:'p2',items:[{desc:'Sewa Unit-101 - Mar 2026',qty:1,unitPrice:3500000,amount:3500000}],totalAmount:3500000,month:'2026-03',dueDate:'2026-03-01',paidDate:'2026-03-01',status:'paid',paymentMethod:'Transfer Mandiri',notes:'',createdAt:'2026-03-01'},
    {id:'i4',invNo:'INV-202602-1001',tenantId:'t1',roomId:'r1',propertyId:'p1',items:[{desc:'Sewa A-01 - Feb 2026',qty:1,unitPrice:1200000,amount:1200000}],totalAmount:1200000,month:'2026-02',dueDate:'2026-02-05',paidDate:'2026-02-04',status:'paid',paymentMethod:'Transfer BCA',notes:'',createdAt:'2026-02-01'},
    {id:'i5',invNo:'INV-202602-1002',tenantId:'t2',roomId:'r2',propertyId:'p1',items:[{desc:'Sewa A-02 - Feb 2026',qty:1,unitPrice:1200000,amount:1200000}],totalAmount:1200000,month:'2026-02',dueDate:'2026-02-05',paidDate:'2026-02-07',status:'paid',paymentMethod:'QRIS',notes:'',createdAt:'2026-02-01'},
    {id:'i6',invNo:'INV-202602-1003',tenantId:'t3',roomId:'r4',propertyId:'p2',items:[{desc:'Sewa Unit-101 - Feb 2026',qty:1,unitPrice:3500000,amount:3500000}],totalAmount:3500000,month:'2026-02',dueDate:'2026-02-01',paidDate:'2026-02-01',status:'paid',paymentMethod:'Transfer Mandiri',notes:'',createdAt:'2026-02-01'},
    {id:'i7',invNo:'INV-202601-1001',tenantId:'t1',roomId:'r1',propertyId:'p1',items:[{desc:'Sewa A-01 - Jan 2026',qty:1,unitPrice:1200000,amount:1200000}],totalAmount:1200000,month:'2026-01',dueDate:'2026-01-05',paidDate:'2026-01-05',status:'paid',paymentMethod:'Transfer BCA',notes:'',createdAt:'2026-01-01'},
    {id:'i8',invNo:'INV-202601-1002',tenantId:'t2',roomId:'r2',propertyId:'p1',items:[{desc:'Sewa A-02 - Jan 2026',qty:1,unitPrice:1200000,amount:1200000}],totalAmount:1200000,month:'2026-01',dueDate:'2026-01-05',paidDate:'2026-01-06',status:'paid',paymentMethod:'Cash',notes:'',createdAt:'2026-01-01'},
    {id:'i9',invNo:'INV-202601-1003',tenantId:'t3',roomId:'r4',propertyId:'p2',items:[{desc:'Sewa Unit-101 - Jan 2026',qty:1,unitPrice:3500000,amount:3500000}],totalAmount:3500000,month:'2026-01',dueDate:'2026-01-01',paidDate:'2026-01-01',status:'paid',paymentMethod:'Transfer Mandiri',notes:'',createdAt:'2026-01-01'},
    {id:'i10',invNo:'INV-202512-1001',tenantId:'t1',roomId:'r1',propertyId:'p1',items:[{desc:'Sewa A-01 - Des 2025',qty:1,unitPrice:1200000,amount:1200000}],totalAmount:1200000,month:'2025-12',dueDate:'2025-12-05',paidDate:'2025-12-04',status:'paid',paymentMethod:'Transfer BCA',notes:'',createdAt:'2025-12-01'},
    {id:'i11',invNo:'INV-202512-1002',tenantId:'t2',roomId:'r2',propertyId:'p1',items:[{desc:'Sewa A-02 - Des 2025',qty:1,unitPrice:1200000,amount:1200000}],totalAmount:1200000,month:'2025-12',dueDate:'2025-12-05',paidDate:'2025-12-05',status:'paid',paymentMethod:'Cash',notes:'',createdAt:'2025-12-01'},
    {id:'i12',invNo:'INV-202512-1003',tenantId:'t3',roomId:'r4',propertyId:'p2',items:[{desc:'Sewa Unit-101 - Des 2025',qty:1,unitPrice:3500000,amount:3500000}],totalAmount:3500000,month:'2025-12',dueDate:'2025-12-01',paidDate:'2025-12-01',status:'paid',paymentMethod:'QRIS',notes:'',createdAt:'2025-12-01'}
  ],
  expenses:[
    {id:'e1',propertyId:'p1',category:'Listrik',description:'PLN Januari 2026',amount:450000,date:'2026-01-25',isRecurring:true,recurringDay:25,status:'paid',createdAt:'2026-01-25'},
    {id:'e2',propertyId:'p1',category:'Air (PDAM)',description:'PDAM Januari 2026',amount:150000,date:'2026-01-25',isRecurring:true,recurringDay:25,status:'paid',createdAt:'2026-01-25'},
    {id:'e3',propertyId:'p1',category:'Internet/WiFi',description:'WiFi Januari 2026',amount:350000,date:'2026-01-01',isRecurring:true,recurringDay:1,status:'paid',createdAt:'2026-01-01'},
    {id:'e4',propertyId:'p2',category:'Listrik',description:'PLN Januari 2026',amount:1200000,date:'2026-01-25',isRecurring:true,recurringDay:25,status:'paid',createdAt:'2026-01-25'},
    {id:'e5',propertyId:'p1',category:'Listrik',description:'PLN Februari 2026',amount:480000,date:'2026-02-25',isRecurring:true,recurringDay:25,status:'paid',createdAt:'2026-02-25'},
    {id:'e6',propertyId:'p1',category:'Air (PDAM)',description:'PDAM Februari 2026',amount:150000,date:'2026-02-25',isRecurring:true,recurringDay:25,status:'paid',createdAt:'2026-02-25'},
    {id:'e7',propertyId:'p1',category:'Internet/WiFi',description:'WiFi Februari 2026',amount:350000,date:'2026-02-01',isRecurring:true,recurringDay:1,status:'paid',createdAt:'2026-02-01'},
    {id:'e8',propertyId:'p2',category:'Listrik',description:'PLN Februari 2026',amount:1250000,date:'2026-02-25',isRecurring:true,recurringDay:25,status:'paid',createdAt:'2026-02-25'},
    {id:'e9',propertyId:'p1',category:'Perawatan',description:'Cat ulang koridor Lt.2',amount:500000,date:'2026-02-15',isRecurring:false,recurringDay:null,status:'paid',createdAt:'2026-02-15'},
    {id:'e10',propertyId:'p1',category:'Keamanan',description:'Gaji Satpam Feb 2026',amount:1500000,date:'2026-02-28',isRecurring:true,recurringDay:28,status:'paid',createdAt:'2026-02-28'},
    {id:'e11',propertyId:'p1',category:'Listrik',description:'PLN Maret 2026',amount:510000,date:'2026-03-25',isRecurring:true,recurringDay:25,status:'unpaid',createdAt:'2026-03-01'},
    {id:'e12',propertyId:'p2',category:'Listrik',description:'PLN Maret 2026',amount:1300000,date:'2026-03-25',isRecurring:true,recurringDay:25,status:'unpaid',createdAt:'2026-03-01'},
    {id:'e13',propertyId:'p1',category:'Internet/WiFi',description:'WiFi Maret 2026',amount:350000,date:'2026-03-01',isRecurring:true,recurringDay:1,status:'paid',createdAt:'2026-03-01'}
  ],
  charges:[
    {id:'c1',tenantId:'t1',propertyId:'p1',description:'Laundry Februari 2026',amount:80000,date:'2026-02-28',billed:true,invoiceId:'i4',createdAt:'2026-02-28'},
    {id:'c2',tenantId:'t2',propertyId:'p1',description:'Parkir Motor Maret 2026',amount:50000,date:'2026-03-01',billed:false,invoiceId:null,createdAt:'2026-03-01'},
    {id:'c3',tenantId:'t3',propertyId:'p2',description:'Extra Tenant',amount:200000,date:'2026-03-01',billed:false,invoiceId:null,createdAt:'2026-03-01'}
  ],
  maint:[
    {id:'m1',propertyId:'p1',roomId:'r1',tenantId:'t1',category:'AC',title:'AC tidak dingin',description:'AC kamar A-01 perlu service.',priority:'high',status:'done',vendor:'Service AC Pak Budi',vendorPhone:'081200001111',estimateCost:150000,actualCost:150000,reportedDate:'2026-02-10',resolvedDate:'2026-02-12',notes:'Sudah diisi freon',createdAt:'2026-02-10'},
    {id:'m2',propertyId:'p1',roomId:'r3',tenantId:null,category:'Pintu/Kunci',title:'Kunci kamar B-01 rusak',description:'Tidak bisa dikunci dari luar.',priority:'high',status:'inprogress',vendor:'Tukang Kunci Pak Asep',vendorPhone:'081200002222',estimateCost:100000,actualCost:0,reportedDate:'2026-03-10',resolvedDate:null,notes:'',createdAt:'2026-03-10'},
    {id:'m3',propertyId:'p2',roomId:'r4',tenantId:'t3',category:'Internet/WiFi',title:'WiFi Unit-101 lemot',description:'Kecepatan sangat lambat.',priority:'medium',status:'pending',vendor:'',vendorPhone:'',estimateCost:0,actualCost:0,reportedDate:'2026-03-12',resolvedDate:null,notes:'',createdAt:'2026-03-12'}
  ],
  meters:[
    {id:'mt1',propertyId:'p1',roomId:'r1',tenantId:'t1',month:'2026-02',kwStart:1250,kwEnd:1320,kwUsed:70,tariff:1500,totalAmount:105000,billed:false,invoiceId:null,createdAt:'2026-02-28'},
    {id:'mt2',propertyId:'p1',roomId:'r2',tenantId:'t2',month:'2026-02',kwStart:980,kwEnd:1045,kwUsed:65,tariff:1500,totalAmount:97500,billed:false,invoiceId:null,createdAt:'2026-02-28'},
    {id:'mt3',propertyId:'p1',roomId:'r1',tenantId:'t1',month:'2026-03',kwStart:1320,kwEnd:1390,kwUsed:70,tariff:1500,totalAmount:105000,billed:false,invoiceId:null,createdAt:'2026-03-12'},
    {id:'mt4',propertyId:'p1',roomId:'r2',tenantId:'t2',month:'2026-03',kwStart:1045,kwEnd:1110,kwUsed:65,tariff:1500,totalAmount:97500,billed:false,invoiceId:null,createdAt:'2026-03-12'}
  ]
}


// ─── UI PRIMITIVES ────────────────────────────────────────────────────────────

const C = {
  bg:'#f0f4f8', card:'#fff', side:'#0f172a',
  pri:'#4f46e5', priDk:'#3730a3', priLt:'#eef2ff',
  teal:'#0d9488', tealLt:'#f0fdfa',
  amb:'#d97706', ambLt:'#fffbeb',
  red:'#dc2626', redLt:'#fef2f2',
  grn:'#16a34a', grnLt:'#f0fdf4',
  txt:'#0f172a', mid:'#475569', lite:'#94a3b8', bdr:'#e2e8f0'
}
const DC = {
  bg:'#0f172a', card:'#1e293b', side:'#020617',
  pri:'#818cf8', priDk:'#6366f1', priLt:'#1e1b4b',
  teal:'#2dd4bf', tealLt:'#042f2e',
  amb:'#fbbf24', ambLt:'#292400',
  red:'#f87171', redLt:'#2d0000',
  grn:'#4ade80', grnLt:'#052e16',
  txt:'#f1f5f9', mid:'#94a3b8', lite:'#475569', bdr:'#334155'
}
// Active theme — toggled by App
let _dark = false
const getC = () => _dark ? DC : C
const themeCard = () => ({ background:getC().card, borderRadius:14, border:`1px solid ${getC().bdr}`, boxShadow:'0 1px 4px rgba(0,0,0,0.08)' })

const CS = {
  card: { background:'#fff', borderRadius:14, border:'1px solid #e2e8f0', boxShadow:'0 1px 4px rgba(0,0,0,0.06)' }
}

const inp = (e=false) => ({
  width:'100%', padding:'9px 13px', borderRadius:9,
  border:`1.5px solid ${e?'#f87171':'#e2e8f0'}`, fontSize:13,
  color:'#0f172a', background:'#fff', outline:'none',
  fontFamily:'inherit', boxSizing:'border-box'
})

const btnS = (v='pri', sz='md') => {
  const pad = sz==='sm'?'5px 12px':sz==='lg'?'13px 28px':'9px 18px'
  const fs  = sz==='sm'?12:sz==='lg'?15:13
  const bgs = {
    pri:`linear-gradient(135deg,#4f46e5,#3730a3)`,
    teal:`linear-gradient(135deg,#0d9488,#0f766e)`,
    grn:`linear-gradient(135deg,#16a34a,#15803d)`,
    wa:'linear-gradient(135deg,#25d366,#128c7e)',
    red:'#fef2f2', ghost:'rgba(0,0,0,0.04)', amb:'#fffbeb'
  }
  const cols = { pri:'#fff', teal:'#fff', grn:'#fff', wa:'#fff', red:'#dc2626', ghost:'#475569', amb:'#d97706' }
  return {
    padding:pad, fontSize:fs, fontWeight:700, border:'none', borderRadius:9,
    cursor:'pointer', display:'inline-flex', alignItems:'center', gap:6,
    background:bgs[v]||'#f1f5f9', color:cols[v]||'#475569',
    boxShadow:['pri','teal','grn','wa'].includes(v)?'0 2px 8px rgba(0,0,0,0.18)':'none',
    fontFamily:'inherit', whiteSpace:'nowrap', transition:'opacity 0.15s'
  }
}

const BADGE_MAP = {
  occupied:['#dbeafe','#1e3a8a','Terisi'], vacant:['#dcfce7','#166534','Kosong'],
  maintenance:['#fee2e2','#991b1b','Maintenance'], dirty:['#fef9c3','#713f12','Perlu Dibersihkan'],
  active:['#dbeafe','#1e3a8a','Aktif'], checkedout:['#f3f4f6','#374151','Check-out'],
  paid:['#dcfce7','#166534','Lunas'], overdue:['#fee2e2','#991b1b','Terlambat'],
  unpaid:['#fef9c3','#713f12','Belum Bayar'], kos:['#ede9fe','#5b21b6','Kos'],
  apartemen:['#dbeafe','#1e3a8a','Apartemen'], ruko:['#fce7f3','#9d174d','Ruko'],
  villa:['#d1fae5','#065f46','Villa'], pending:['#fef9c3','#713f12','Menunggu'],
  inprogress:['#dbeafe','#1e3a8a','Dikerjakan'], done:['#dcfce7','#166534','Selesai'],
  owner:['#ede9fe','#5b21b6','Pemilik'], manager:['#dbeafe','#1e3a8a','Manajer'],
  staff:['#f3f4f6','#374151','Staf'], invited:['#fef9c3','#713f12','Diundang'],
  high:['#fee2e2','#991b1b','Tinggi'], medium:['#fef9c3','#713f12','Sedang'], low:['#dcfce7','#166534','Rendah']
}
function Badge({ s }) {
  const [bg,co,lbl] = BADGE_MAP[s] || ['#f1f5f9','#475569', s||'—']
  return <span style={{background:bg,color:co,padding:'3px 10px',borderRadius:99,fontSize:11,fontWeight:700,letterSpacing:'0.03em',whiteSpace:'nowrap'}}>{lbl}</span>
}

function StatCard({ icon, label, value, sub, accent=C.pri, onClick }) {
  const [hov,setHov] = useState(false)
  return (
    <div onClick={onClick} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{...CS.card,padding:'16px 18px',display:'flex',gap:12,alignItems:'center',cursor:onClick?'pointer':'default',boxShadow:hov&&onClick?'0 6px 20px rgba(0,0,0,0.12)':CS.card.boxShadow,transition:'box-shadow 0.15s'}}>
      <div style={{width:44,height:44,borderRadius:12,background:accent+'18',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>{icon}</div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:10,color:C.lite,fontWeight:700,marginBottom:2,textTransform:'uppercase',letterSpacing:'0.06em'}}>{label}</div>
        <div style={{fontSize:21,fontWeight:800,color:C.txt,lineHeight:1.1}}>{value}</div>
        {sub && <div style={{fontSize:11,color:C.mid,marginTop:2}}>{sub}</div>}
      </div>
    </div>
  )
}

function Modal({ title, subtitle, onClose, children, width=560 }) {
  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,backdropFilter:'blur(3px)',padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:18,width,maxWidth:'100%',maxHeight:'92vh',overflow:'hidden',display:'flex',flexDirection:'column',boxShadow:'0 32px 80px rgba(0,0,0,0.24)'}}>
        <div style={{padding:'18px 22px 14px',borderBottom:'1px solid #e2e8f0',flexShrink:0,display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
          <div>
            <h2 style={{margin:0,fontSize:16,fontWeight:800,color:C.txt}}>{title}</h2>
            {subtitle && <p style={{margin:'3px 0 0',fontSize:12,color:C.mid}}>{subtitle}</p>}
          </div>
          <button onClick={onClose} style={{...btnS('ghost','sm'),fontSize:18,padding:'2px 8px'}}>✕</button>
        </div>
        <div style={{padding:22,overflowY:'auto',flex:1}}>{children}</div>
      </div>
    </div>
  )
}

function Confirm({ msg, onYes, onNo, yesLabel='Ya, Hapus', yesV='red' }) {
  return (
    <div onClick={onNo} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1100,backdropFilter:'blur(3px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:16,padding:28,width:360,maxWidth:'calc(100vw - 32px)',boxShadow:'0 24px 64px rgba(0,0,0,0.2)',textAlign:'center'}}>
        <div style={{fontSize:40,marginBottom:10}}>⚠️</div>
        <p style={{fontSize:14,color:C.mid,margin:'0 0 20px',lineHeight:1.6}}>{msg}</p>
        <div style={{display:'flex',gap:10,justifyContent:'center'}}>
          <button style={btnS('ghost')} onClick={onNo}>Batal</button>
          <button style={btnS(yesV)} onClick={onYes}>{yesLabel}</button>
        </div>
      </div>
    </div>
  )
}

function Toast({ msg, type='success' }) {
  const bg = {success:C.grn, error:C.red, warn:C.amb, info:C.pri}[type] || C.grn
  return (
    <div style={{position:'fixed',bottom:24,right:24,background:bg,color:'#fff',padding:'12px 20px',borderRadius:12,fontSize:13,fontWeight:600,zIndex:9999,boxShadow:'0 8px 24px rgba(0,0,0,0.22)',maxWidth:360,animation:'toastIn 0.25s ease'}}>
      {msg}
    </div>
  )
}

function Empty({ icon='📭', title, sub }) {
  return (
    <div style={{textAlign:'center',padding:'48px 20px',color:C.mid}}>
      <div style={{fontSize:48,marginBottom:12}}>{icon}</div>
      <div style={{fontWeight:700,fontSize:15,color:C.txt,marginBottom:6}}>{title}</div>
      {sub && <div style={{fontSize:13}}>{sub}</div>}
    </div>
  )
}

function Tabs({ tabs, active, onChange }) {
  return (
    <div style={{display:'flex',gap:4,background:C.bg,borderRadius:10,padding:4,marginBottom:18,flexWrap:'wrap'}}>
      {tabs.map(t => (
        <button key={t.id} onClick={()=>onChange(t.id)}
          style={{...btnS(active===t.id?'pri':'ghost','sm'),borderRadius:7,flex:1,justifyContent:'center',minWidth:80}}>
          {t.icon && <span>{t.icon}</span>}{t.label}
          {t.count>0 && <span style={{background:'rgba(255,255,255,0.28)',borderRadius:99,padding:'1px 6px',fontSize:10,marginLeft:4}}>{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

function Spinner({ size=32 }) {
  return <div style={{width:size,height:size,border:'3px solid #e2e8f0',borderTop:`3px solid ${C.pri}`,borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
}

// Form primitives
const FGrid = ({children, cols=2}) => (
  <div style={{display:'grid',gridTemplateColumns:`repeat(${cols},1fr)`,gap:12,marginBottom:14}}>
    {children}
  </div>
)
const Fld = ({label, error, children}) => (
  <div>
    <label style={{fontSize:11,fontWeight:700,color:C.mid,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.04em'}}>
      {label}
      {error && <span style={{color:C.red,marginLeft:6,fontWeight:400,textTransform:'none'}}>{error}</span>}
    </label>
    {children}
  </div>
)
const Inp  = ({label,error,...p}) => <Fld label={label} error={error}><input {...p} style={inp(!!error)}/></Fld>
const Sel  = ({label,error,children,...p}) => <Fld label={label} error={error}><select {...p} style={inp(!!error)}>{children}</select></Fld>
const Txa  = ({label,error,rows=3,...p}) => <Fld label={label} error={error}><textarea rows={rows} {...p} style={{...inp(!!error),resize:'vertical'}}/></Fld>

// Global styles injected once
const GlobalStyles = ({dark}) => (
  <style>{`
    @keyframes toastIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes fadeIn{from{opacity:0}to{opacity:1}}
    *{box-sizing:border-box}
    input,select,textarea,button{font-family:inherit;background:${dark?'#1e293b':'#fff'};color:${dark?'#f1f5f9':'#0f172a'}}
    body{background:${dark?'#0f172a':'#f0f4f8'};color:${dark?'#f1f5f9':'#0f172a'};transition:background 0.2s}
    ::-webkit-scrollbar{width:6px;height:6px}
    ::-webkit-scrollbar-thumb{background:${dark?'#475569':'#cbd5e1'};border-radius:3px}
    @media print{.no-print{display:none!important}}
    @media(max-width:768px){.hide-mobile{display:none!important}.mobile-full{width:100%!important}}
  `}</style>
)

// ─── APP ──────────────────────────────────────────────────────────────────────


// ─── PRINT HELPERS (self-contained, no outer scope) ──────────────────────────
function printInvoice(inv, tenant, room, prop, mode='print') {
  const fmtRp = n => 'Rp '+Number(n||0).toLocaleString('id-ID')
  const getLbl = m => { if(!m)return''; const [y,mo]=m.split('-'); return ['','Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'][+mo]+' '+y }
  const rows = (inv.items||[]).map(it=>`<tr><td>${it.desc||''}</td><td style="text-align:center">${it.qty||1}</td><td class="r">${fmtRp(it.unitPrice)}</td><td class="r">${fmtRp(it.amount)}</td></tr>`).join('')
  const isPaid = inv.status==='paid'
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Kwitansi ${inv.invNo}</title>
<style>
  @page{size:A5 landscape;margin:12mm}
  *{box-sizing:border-box}
  body{font-family:'Segoe UI',Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#1e293b;font-size:13px}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;padding-bottom:12px;border-bottom:3px solid #4f46e5}
  .prop-name{font-size:18px;font-weight:800;color:#1e293b;margin:0 0 4px}
  .prop-addr{font-size:11px;color:#64748b;margin:0}
  .inv-no{font-size:22px;font-weight:900;color:#4f46e5;text-align:right}
  .badge{display:inline-block;padding:4px 14px;border-radius:99px;font-size:12px;font-weight:700}
  .paid-badge{background:#dcfce7;color:#15803d}
  .unpaid-badge{background:#fee2e2;color:#dc2626}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}
  .info-box{background:#f8fafc;border-radius:8px;padding:8px 12px}
  .info-lbl{font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;font-weight:600;margin-bottom:2px}
  .info-val{font-size:13px;font-weight:600;color:#1e293b}
  table{width:100%;border-collapse:collapse;margin:12px 0;font-size:12px}
  th{background:#4f46e5;color:#fff;padding:8px 10px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
  td{padding:7px 10px;border-bottom:1px solid #f1f5f9}
  .r{text-align:right}
  .total-row td{font-weight:800;font-size:15px;border-top:2px solid #4f46e5;color:#1e293b;padding-top:10px}
  .bank-box{background:#eef2ff;border-radius:8px;padding:10px 14px;margin-top:10px;font-size:12px;color:#4f46e5}
  .footer{margin-top:16px;text-align:center;font-size:10px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:10px}
  .proof-section{margin-top:12px;background:#f0fdf4;border-radius:8px;padding:10px 14px;font-size:11px;color:#166534}
  .no-print{margin-top:16px;display:flex;gap:8px;justify-content:center}
  .btn{padding:8px 20px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:700}
  .btn-pri{background:#4f46e5;color:#fff}
  .btn-sec{background:#f1f5f9;color:#475569}
  @media print{.no-print{display:none!important}}
</style></head><body>
<div class="header">
  <div>
    <div class="prop-name">${prop?.name||'Properti'}</div>
    <div class="prop-addr">${prop?.address||''}</div>
    ${prop?.phone?`<div class="prop-addr">📱 ${prop.phone}</div>`:''}
  </div>
  <div style="text-align:right">
    <div class="inv-no">${inv.invNo}</div>
    <div class="badge ${isPaid?'paid-badge':'unpaid-badge'}" style="margin-top:6px">
      ${isPaid?'✓ KWITANSI PEMBAYARAN':'⏳ TAGIHAN BELUM LUNAS'}
    </div>
  </div>
</div>
<div class="info-grid">
  <div class="info-box"><div class="info-lbl">Kepada</div><div class="info-val">${tenant?.name||'—'}</div></div>
  <div class="info-box"><div class="info-lbl">Kamar</div><div class="info-val">${room?.number||'—'} · ${room?.type||''}</div></div>
  <div class="info-box"><div class="info-lbl">Periode</div><div class="info-val">${getLbl(inv.month)}</div></div>
  <div class="info-box"><div class="info-lbl">Jatuh Tempo</div><div class="info-val">${inv.dueDate||'—'}</div></div>
  ${isPaid?`<div class="info-box"><div class="info-lbl">Tgl Dibayar</div><div class="info-val">${inv.paidDate||'—'}</div></div>
  <div class="info-box"><div class="info-lbl">Metode</div><div class="info-val">${inv.paymentMethod||'—'}</div></div>`:''}
</div>
<table>
  <thead><tr><th>Keterangan</th><th style="text-align:center">Qty</th><th class="r">Harga</th><th class="r">Total</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr class="total-row"><td colspan="3" class="r">TOTAL</td><td class="r">${fmtRp(inv.totalAmount)}</td></tr></tfoot>
</table>
${prop?.bankName?`<div class="bank-box">🏦 Pembayaran ke: <b>${prop.bankName} ${prop.bankAccount}</b> a.n. ${prop.bankHolder}</div>`:''}
${inv.proofExtracted?.sender?`<div class="proof-section">✅ Bukti transfer terverifikasi · Pengirim: ${inv.proofExtracted.sender} · ${inv.proofExtracted.bank||''} · ${inv.proofExtracted.ref||''}</div>`:''}
${inv.notes?`<p style="font-size:11px;color:#64748b;margin-top:8px">📝 ${inv.notes}</p>`:''}
<div class="footer">KosManager Pro · Dicetak ${new Date().toLocaleDateString('id-ID',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</div>
<div class="no-print">
  <button class="btn btn-pri" onclick="window.print()">🖨️ Print / Save PDF</button>
  <button class="btn btn-sec" onclick="window.close()">Tutup</button>
</div>
<script>if('${mode}'==='print')window.onload=function(){window.print()}<\/script>
</body></html>`
  const w = window.open('','_blank','width=750,height=600')
  if(w){w.document.write(html);w.document.close()}
}

function printKontrak(tenant, room, prop, mode='print') {
  const fmtRp = n => 'Rp '+Number(n||0).toLocaleString('id-ID')
  const PLBL  = {daily:'Harian',weekly:'Mingguan',monthly:'Bulanan',yearly:'Tahunan'}
  const pl    = PLBL[tenant?.rentPeriod]||'Bulanan'
  const today = new Date().toLocaleDateString('id-ID',{weekday:'long',year:'numeric',month:'long',day:'numeric'})
  const todayS = new Date().toLocaleDateString('id-ID')
  const facs  = (room?.facilities||[]).join(', ')||'—'
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Kontrak Sewa — ${tenant?.name||''}</title>
<style>
  @page{size:A4;margin:20mm 18mm}
  *{box-sizing:border-box}
  body{font-family:'Times New Roman',serif;max-width:700px;margin:0 auto;padding:24px;color:#111;font-size:13px;line-height:1.9}
  .kop{text-align:center;border-bottom:3px double #111;padding-bottom:12px;margin-bottom:16px}
  .kop h1{margin:0;font-size:16px;text-transform:uppercase;letter-spacing:.08em}
  .kop h2{margin:4px 0 0;font-size:13px;font-weight:normal}
  table{width:100%;border-collapse:collapse;margin:8px 0}
  td{padding:3px 8px;vertical-align:top}td:first-child{width:36%;font-weight:bold}
  h3{font-size:13px;margin:16px 0 4px;text-decoration:underline;font-style:italic}
  .sign-area{display:grid;grid-template-columns:1fr 1fr;gap:60px;margin-top:50px}
  .sign-box{text-align:center;border-top:1px solid #111;padding-top:8px}
  .pasal{margin:12px 0}
  .materai{width:80px;height:80px;border:1px dashed #aaa;display:flex;align-items:center;justify-content:center;font-size:10px;color:#aaa;margin:0 auto 8px;border-radius:4px}
  .no-print{margin-top:20px;display:flex;gap:8px;justify-content:center}
  .btn{padding:8px 20px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:700}
  .btn-pri{background:#4f46e5;color:#fff}
  .btn-sec{background:#f1f5f9;color:#475569}
  @media print{.no-print{display:none!important}}
</style></head><body>
<div class="kop">
  <div style="font-size:11px;color:#555;margin-bottom:4px">${prop?.name||''}</div>
  <h1>Perjanjian Sewa Menyewa Kamar</h1>
  <h2>${prop?.address||''}</h2>
</div>
<p>Pada hari <b>${today}</b>, kami yang bertanda tangan di bawah ini:</p>
<h3>Pihak Pertama — Pemilik</h3>
<table>
  <tr><td>Nama</td><td>: ${prop?.bankHolder||'Pemilik'}</td></tr>
  <tr><td>Telepon</td><td>: ${prop?.phone||'—'}</td></tr>
  <tr><td>Alamat Properti</td><td>: ${prop?.address||'—'}</td></tr>
</table>
<h3>Pihak Kedua — Penyewa</h3>
<table>
  <tr><td>Nama Lengkap</td><td>: ${tenant?.name||''}</td></tr>
  <tr><td>No. KTP</td><td>: ${tenant?.idNumber||'—'}</td></tr>
  <tr><td>Telepon / WA</td><td>: ${tenant?.phone||'—'}</td></tr>
  <tr><td>Email</td><td>: ${tenant?.email||'—'}</td></tr>
  <tr><td>Pekerjaan</td><td>: ${tenant?.occupation||'—'}</td></tr>
  <tr><td>Kontak Darurat</td><td>: ${tenant?.emergencyContact||'—'}</td></tr>
</table>
<p>Dengan ini menyepakati perjanjian sewa kamar sebagai berikut:</p>
<h3>Detail Objek Sewa</h3>
<table>
  <tr><td>Nomor Kamar</td><td>: ${room?.number||'—'} (${room?.type||'—'}, Lt. ${room?.floor||'—'})</td></tr>
  <tr><td>Ukuran</td><td>: ${room?.size||'—'}</td></tr>
  <tr><td>Fasilitas</td><td>: ${facs}</td></tr>
  <tr><td>Periode Sewa</td><td>: ${pl}</td></tr>
  <tr><td>Harga Sewa</td><td>: <b>${fmtRp(tenant?.rentAmount||0)}</b> per ${pl}</td></tr>
  <tr><td>Uang Muka / Deposit</td><td>: ${fmtRp(tenant?.depositAmount||0)}</td></tr>
  <tr><td>Tanggal Check-in</td><td>: <b>${tenant?.checkInDate||'—'}</b></td></tr>
  <tr><td>Tanggal Check-out</td><td>: <b>${tenant?.checkOutDate||'—'}</b></td></tr>
</table>
<div class="pasal">
  <h3>Pasal 1 — Pembayaran</h3>
  <p>Pihak Kedua wajib membayar uang sewa paling lambat tanggal <b>5</b> setiap bulannya kepada Pihak Pertama melalui: <b>${prop?.bankName||'—'} ${prop?.bankAccount||''}</b> atas nama <b>${prop?.bankHolder||''}</b>.</p>
</div>
<div class="pasal">
  <h3>Pasal 2 — Kewajiban Penyewa</h3>
  <p>Pihak Kedua berkewajiban: (a) menjaga kebersihan dan ketertiban; (b) tidak merusak fasilitas yang tersedia; (c) tidak membawa tamu menginap lebih dari 1 malam tanpa izin tertulis; (d) tidak melakukan kegiatan yang melanggar hukum.</p>
</div>
<div class="pasal">
  <h3>Pasal 3 — Deposit dan Jaminan</h3>
  <p>Deposit sebesar <b>${fmtRp(tenant?.depositAmount||0)}</b> akan dikembalikan selambatnya 7 hari setelah check-out, dikurangi biaya kerusakan dan/atau tunggakan yang belum diselesaikan.</p>
</div>
<div class="pasal">
  <h3>Pasal 4 — Pengakhiran Kontrak</h3>
  <p>Pihak Kedua wajib memberitahu Pihak Pertama minimal <b>30 hari</b> sebelum tanggal check-out. Keterlambatan pemberitahuan dapat dikenakan biaya sesuai kesepakatan.</p>
</div>
<div class="pasal">
  <h3>Pasal 5 — Penyelesaian Sengketa</h3>
  <p>Apabila terjadi perselisihan, kedua pihak sepakat untuk menyelesaikan secara musyawarah mufakat.</p>
</div>
<p>Perjanjian ini dibuat dalam 2 (dua) rangkap, masing-masing bermaterai cukup dan mempunyai kekuatan hukum yang sama.</p>
<div class="sign-area">
  <div class="sign-box">
    <p>${todayS}</p>
    <div class="materai">Meterai 10.000</div>
    <b>${prop?.bankHolder||'Pemilik'}</b>
    <p style="margin:0;font-size:11px;color:#555">Pihak Pertama</p>
  </div>
  <div class="sign-box">
    <p>${todayS}</p>
    <div class="materai">Meterai 10.000</div>
    <b>${tenant?.name||''}</b>
    <p style="margin:0;font-size:11px;color:#555">Pihak Kedua</p>
  </div>
</div>
<div class="no-print">
  <button class="btn btn-pri" onclick="window.print()">🖨️ Print / Save PDF</button>
  <button class="btn btn-sec" onclick="window.close()">Tutup</button>
</div>
<script>if('${mode}'==='print')window.onload=function(){window.print()}<\/script>
</body></html>`
  const w = window.open('','_blank','width=820,height=1000')
  if(w){w.document.write(html);w.document.close()}
}

// ─── GOOGLE VISION AI — BACA BUKTI TRANSFER ──────────────────────────────────

// Panggil Google Vision API dengan base64 image
async function callVisionAPI(base64Image, apiKey) {
  const body = {
    requests: [{
      image: { content: base64Image },
      features: [{ type: 'TEXT_DETECTION', maxResults: 1 }]
    }]
  }
  const res = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }
  )
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error?.message || 'Vision API error')
  }
  const data = await res.json()
  return data.responses?.[0]?.fullTextAnnotation?.text || ''
}

// ─── GOOGLE DRIVE UPLOAD via Apps Script ─────────────────────────────────────
async function uploadToDrive(scriptUrl, { base64Image, filename, folderPath, secret }) {
  if (!scriptUrl || !base64Image) return null
  try {
    // Apps Script dengan no-cors: browser tidak bisa baca response
    // tapi request tetap dikirim dan diproses oleh server
    // Kita anggap berhasil jika tidak ada network error
    await fetch(scriptUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'uploadFile',
        secret: secret||'',
        filename,
        folderPath,
        base64: base64Image,
        mimeType: 'image/jpeg'
      })
    })
    // no-cors: fetch berhasil = request terkirim ke Apps Script
    // File akan muncul di Drive dalam beberapa detik
    return `${folderPath}/${filename}`
  } catch(e) {
    // Network error (offline, URL salah)
    console.error('Drive upload error:', e.message)
    return null
  }
}

// Sync ke Sheets dengan secret token
async function syncToSheets(scriptUrl, payload, secret) {
  if (!scriptUrl) return false
  try {
    await fetch(scriptUrl, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, secret: secret||'' })
    })
    return true
  } catch(e) { return false }
}

function buildDrivePath(date, tenantName, amount, propertyName, bank) {
  const d = new Date(date || new Date())
  const year = d.getFullYear()
  const mo = String(d.getMonth()+1).padStart(2,'0')
  const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des']
  const monthLabel = mo+'-'+MONTH_NAMES[d.getMonth()+1]
  const day = String(d.getDate()).padStart(2,'0')
  const safeName = (tenantName||'').replace(/[^a-zA-Z0-9]/g,'').slice(0,20)
  const amtStr = 'Rp'+Number(amount||0).toLocaleString('id-ID')
  const bankStr = (bank||'Transfer').replace(/\s/g,'')
  const filename = day+'_'+safeName+'_'+amtStr+'_'+bankStr+'.jpg'
  const folderPath = 'KosManager Pro/'+year+'-'+mo+' '+MONTH_NAMES[d.getMonth()+1]+'/'+
    (propertyName||'Properti').replace(/[\/]/g,'-')
  return { folderPath, filename }
}


// Parse teks OCR → ekstrak data transfer
function parseTransferText(text) {
  if (!text) return {}
  const clean = text.replace(/\n/g,' ').replace(/\s+/g,' ')

  // --- JUMLAH ---
  // Format: Rp 1.200.000 / Rp1.200.000,00 / 1,200,000 / IDR 1200000
  const amountPatterns = [
    /Rp\.?\s*([\d.,]+)/gi,
    /IDR\.?\s*([\d.,]+)/gi,
    /nominal[^0-9]*([\d.,]+)/gi,
    /jumlah[^0-9]*([\d.,]+)/gi,
    /total[^0-9]*([\d.,]+)/gi,
    /transfer[^0-9]*([\d.,]+)/gi,
    /nominal transfer[^0-9]*([\d.,]+)/gi,
  ]
  let amount = 0
  for (const pat of amountPatterns) {
    const matches = [...clean.matchAll(pat)]
    for (const m of matches) {
      const raw = m[1].replace(/\./g,'').replace(/,\d{2}$/,'').replace(/,/g,'')
      const num = parseInt(raw)
      if (num > 10000 && num < 1e10) { amount = num; break }
    }
    if (amount > 0) break
  }

  // --- TANGGAL ---
  const datePatterns = [
    /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/,   // DD/MM/YYYY
    /(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/,   // YYYY-MM-DD
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agu?s?|Sep|Okt|Nov|Des)\w*\s+(\d{4})/i,
    /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i,
  ]
  const MONTH_ID = {jan:1,feb:2,mar:3,apr:4,mei:5,jun:6,jul:7,agu:8,ags:8,sep:9,okt:10,nov:11,des:12,
    january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12}
  let date = ''
  for (const pat of datePatterns) {
    const m = clean.match(pat)
    if (m) {
      try {
        if (isNaN(parseInt(m[2]))) {
          const mo = MONTH_ID[m[2].toLowerCase().slice(0,3)] || 1
          date = `${m[3]}-${String(mo).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`
        } else if (m[1].length===4) {
          date = `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`
        } else {
          date = `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`
        }
        if (!isNaN(new Date(date))) break
      } catch(e) { date = '' }
    }
  }

  // --- JAM ---
  const timeM = clean.match(/(\d{2}):(\d{2})(?::(\d{2}))?/)
  const time = timeM ? timeM[0] : ''

  // --- BANK ---
  const bankNames = ['BCA','Mandiri','BRI','BNI','BSI','CIMB','Danamon','Permata','BTN','Ocbc','Jenius','SeaBank','Neo','Jago','Allo','BNC','Maybank','Panin']
  let bank = ''
  for (const b of bankNames) {
    if (new RegExp(b,'i').test(clean)) { bank = b; break }
  }

  // --- NAMA PENGIRIM ---
  const senderPatterns = [
    /(?:dari|from|pengirim|sender)[:\s]+([A-Z][A-Z\s]{3,40})/i,
    /(?:nama rekening|account name)[:\s]+([A-Z][A-Z\s]{3,40})/i,
    /(?:atas nama)[:\s]+([A-Z][A-Z\s]{3,40})/i,
  ]
  let sender = ''
  for (const pat of senderPatterns) {
    const m = clean.match(pat)
    if (m) { sender = m[1].trim(); break }
  }

  // --- NO REFERENSI ---
  const refPatterns = [
    /(?:no\.?\s*ref|referensi|reference|trx\s*id|transaction\s*id|kode\s*transaksi)[:\s#]*([A-Z0-9]{8,30})/i,
    /(?:no\.?\s*transaksi)[:\s]*([0-9]{8,20})/i,
  ]
  let ref = ''
  for (const pat of refPatterns) {
    const m = clean.match(pat)
    if (m) { ref = m[1].trim(); break }
  }

  // --- REKENING TUJUAN ---
  const destPatterns = [
    /(?:ke|tujuan|rekening tujuan|destination)[:\s]+([0-9\-]{8,20})/i,
    /(?:account|rekening)[:\s]+([0-9\-]{8,20})/i,
  ]
  let destAccount = ''
  for (const pat of destPatterns) {
    const m = clean.match(pat)
    if (m) { destAccount = m[1].trim(); break }
  }

  return { amount, date, time, bank, sender, ref, destAccount, rawText:text.slice(0,300) }
}

// Konversi File ke base64
function fileToBase64(file) {
  return new Promise((res,rej) => {
    const reader = new FileReader()
    reader.onload = e => res(e.target.result.split(',')[1])
    reader.onerror = rej
    reader.readAsDataURL(file)
  })
}

// Resize image sebelum dikirim ke Vision API (hemat quota)
// ── UPLOAD BUKTI TRANSFER KE GOOGLE DRIVE ────────────────────────────────────

function resizeForVision(file, maxW=1600) {
  return new Promise((res,rej) => {
    const reader = new FileReader()
    reader.onload = e => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, maxW/img.width)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width*scale)
        canvas.height = Math.round(img.height*scale)
        canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height)
        // Return both preview URL and base64
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
        res({ dataUrl, base64: dataUrl.split(',')[1] })
      }
      img.onerror = rej
      img.src = e.target.result
    }
    reader.onerror = rej
    reader.readAsDataURL(file)
  })
}

// ── PROOF UPLOAD MODAL ────────────────────────────────────────────────────────
// ─── AI RECEIPT/EXPENSE SCANNER ──────────────────────────────────────────────

// Parse teks OCR nota/kwitansi pengeluaran
function parseReceiptText(text) {
  if (!text) return {}
  const clean = text.replace(/
/g,' ').replace(/\s+/g,' ')

  // Nominal
  let amount = 0
  const amtPatterns = [/Rp\.?\s*([\d.,]+)/gi,/IDR\.?\s*([\d.,]+)/gi,/total[^0-9]*([\d.,]+)/gi,/jumlah[^0-9]*([\d.,]+)/gi,/harga[^0-9]*([\d.,]+)/gi,/([\d]{1,3}(?:[.,]\d{3})+)/g]
  for (const pat of amtPatterns) {
    const matches = [...clean.matchAll(pat)]
    for (const m of matches) {
      const raw = m[1].replace(/\./g,'').replace(/,\d{2}$/,'').replace(/,/g,'')
      const num = parseInt(raw)
      if (num > 5000 && num < 1e10) { amount = num; break }
    }
    if (amount > 0) break
  }

  // Tanggal
  let date = ''
  const datePats = [/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/,/(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/,/(\d{1,2})\s+(Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agu?s?|Sep|Okt|Nov|Des)\w*\s+(\d{4})/i]
  const MN = {jan:1,feb:2,mar:3,apr:4,mei:5,jun:6,jul:7,agu:8,ags:8,sep:9,okt:10,nov:11,des:12}
  for (const p of datePats) {
    const m = clean.match(p)
    if (m) {
      try {
        if (isNaN(parseInt(m[2]))) {
          const mo = MN[m[2].toLowerCase().slice(0,3)]||1
          date = `${m[3]}-${String(mo).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`
        } else if (m[1].length===4) {
          date = `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`
        } else {
          date = `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`
        }
        if (!isNaN(new Date(date))) break
        date = ''
      } catch(e) { date = '' }
    }
  }

  // Auto-detect kategori dari kata kunci
  const cl = clean.toLowerCase()
  let category = 'Lainnya'
  if (/ac|air.?conditioner|freon|kulkas|mesin.?cuci|elektronik|alat/.test(cl)) category = 'Perawatan'
  else if (/listrik|pln|kwh|daya|token|meteran/.test(cl)) category = 'Listrik'
  else if (/pdam|air|pompa|pipa|keran|saluran/.test(cl)) category = 'Air (PDAM)'
  else if (/wifi|internet|indihome|firstmedia|speedy|jaringan/.test(cl)) category = 'Internet/WiFi'
  else if (/banjar|ipl|pengelola|keamanan|satpam|security/.test(cl)) category = 'Keamanan'
  else if (/kebersihan|sampah|cleaning|sapuan/.test(cl)) category = 'Kebersihan'
  else if (/cat|material|bahan|bangunan|keramik|semen/.test(cl)) category = 'Perbaikan'
  else if (/pajak|pbb|stnk|retribusi|bpjs/.test(cl)) category = 'Pajak'
  else if (/gaji|upah|tukang|tenaga|kerja/.test(cl)) category = 'Gaji Pegawai'
  else if (/asuransi|premi|pertanggungan/.test(cl)) category = 'Asuransi'
  else if (/perbaikan|servis|service|reparasi|spare|part/.test(cl)) category = 'Perawatan'

  // Nama toko/vendor
  let vendor = ''
  const vendorPat = /(?:dari|to|toko|cv|pt|ud|bengkel|salon|counter)[:\s]+([A-Za-z0-9\s]{3,30})/i
  const vm = clean.match(vendorPat)
  if (vm) vendor = vm[1].trim()

  // Deskripsi singkat dari teks awal
  const desc = clean.slice(0, 60).trim()

  return { amount, date, category, vendor, desc, rawText: text.slice(0, 400) }
}

// Panggil Claude API untuk analisis lebih cerdas (opsional, jika ada key)
async function analyzeWithClaude(base64Image, apiKey, prompt) {
  if (!apiKey) return null
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Image } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.content?.[0]?.text || null
  } catch(e) { return null }
}

// Deteksi anomali pengeluaran (tagihan tidak wajar)
function detectAnomalies(data) {
  const { expenses, meters, invoices, props, rooms } = data
  const alerts = []
  const today = todayStr()
  const thisMonth = nowMonth()
  const lastMonth = (() => { const d=new Date(); d.setMonth(d.getMonth()-1); return d.toISOString().slice(0,7) })()
  const prev2Month = (() => { const d=new Date(); d.setMonth(d.getMonth()-2); return d.toISOString().slice(0,7) })()

  // 1. Cek lonjakan tagihan listrik per properti
  props.forEach(p => {
    const cat = 'Listrik'
    const thisExp  = expenses.filter(e=>e.propertyId===p.id&&e.category===cat&&e.date.startsWith(thisMonth)).reduce((s,e)=>s+e.amount,0)
    const lastExp  = expenses.filter(e=>e.propertyId===p.id&&e.category===cat&&e.date.startsWith(lastMonth)).reduce((s,e)=>s+e.amount,0)
    const prev2Exp = expenses.filter(e=>e.propertyId===p.id&&e.category===cat&&e.date.startsWith(prev2Month)).reduce((s,e)=>s+e.amount,0)
    const avg = (lastExp + prev2Exp) / 2
    if (thisExp > 0 && avg > 0 && thisExp > avg * 1.5) {
      alerts.push({
        type: 'expense_spike', severity: 'high',
        icon: '⚡', color: '#dc2626',
        title: `Tagihan listrik ${p.name} naik drastis`,
        detail: `${mLabel(thisMonth)}: ${fmt(thisExp)} vs rata-rata ${fmt(Math.round(avg))} (+${Math.round((thisExp/avg-1)*100)}%)`,
        suggestion: 'Periksa meteran dan kemungkinan kebocoran arus.',
        propertyId: p.id
      })
    }
  })

  // 2. Cek lonjakan pemakaian air per kamar (dari meteran listrik sebagai proxy)
  rooms.forEach(r => {
    const thisKwh  = meters.filter(m=>m.roomId===r.id&&m.month===thisMonth).reduce((s,m)=>s+m.kwUsed,0)
    const lastKwh  = meters.filter(m=>m.roomId===r.id&&m.month===lastMonth).reduce((s,m)=>s+m.kwUsed,0)
    const prev2Kwh = meters.filter(m=>m.roomId===r.id&&m.month===prev2Month).reduce((s,m)=>s+m.kwUsed,0)
    const avg = (lastKwh + prev2Kwh) / 2
    if (thisKwh > 0 && avg > 0 && thisKwh > avg * 2) {
      const prop = props.find(p=>p.id===r.propertyId)
      alerts.push({
        type: 'meter_spike', severity: 'medium',
        icon: '⚡', color: '#d97706',
        title: `Pemakaian listrik kamar ${r.number} tidak wajar`,
        detail: `${mLabel(thisMonth)}: ${thisKwh} kWh vs rata-rata ${Math.round(avg)} kWh (+${Math.round((thisKwh/avg-1)*100)}%)`,
        suggestion: 'Cek apakah ada perangkat boros atau masalah instalasi.',
        propertyId: r.propertyId
      })
    }
  })

  // 3. Tagihan overdue lebih dari 30 hari
  const longOverdue = invoices.filter(i => {
    if (i.status === 'paid') return false
    if (!i.dueDate) return false
    return (new Date(today) - new Date(i.dueDate)) / 864e5 > 30
  })
  if (longOverdue.length > 0) {
    alerts.push({
      type: 'long_overdue', severity: 'high',
      icon: '🚨', color: '#dc2626',
      title: `${longOverdue.length} tagihan menunggak lebih dari 30 hari`,
      detail: longOverdue.slice(0,3).map(i=>i.invNo).join(', ') + (longOverdue.length>3?` +${longOverdue.length-3} lainnya`:''),
      suggestion: 'Segera hubungi penyewa dan pertimbangkan tindakan lanjut.',
      action: 'invoices'
    })
  }

  // 4. Maintenance menunggu lebih dari 14 hari
  const { maint } = data
  const longPending = maint.filter(m => {
    if (m.status === 'done') return false
    if (!m.reportedDate) return false
    return (new Date(today) - new Date(m.reportedDate)) / 864e5 > 14
  })
  if (longPending.length > 0) {
    alerts.push({
      type: 'long_maint', severity: 'medium',
      icon: '🔧', color: '#d97706',
      title: `${longPending.length} maintenance belum selesai > 14 hari`,
      detail: longPending.map(m=>m.title).slice(0,2).join(', '),
      suggestion: 'Percepat penyelesaian untuk kenyamanan penyewa.',
      action: 'maintenance'
    })
  }

  return alerts
}

// ─── AI DAILY SUMMARY ─────────────────────────────────────────────────────────
function generateDailySummary(data, claudeKey) {
  const { invoices, tenants, rooms, expenses, maint, meters, props } = data
  const today     = todayStr()
  const yesterday = (() => { const d=new Date(); d.setDate(d.getDate()-1); return d.toISOString().split('T')[0] })()
  const thisMonth = nowMonth()

  const todayDueInvs  = invoices.filter(i=>i.status!=='paid'&&i.dueDate===today)
  const paidYesterday = invoices.filter(i=>i.paidDate===yesterday&&i.status==='paid')
  const incomeYest    = paidYesterday.reduce((s,i)=>s+i.totalAmount,0)
  const overdue       = invoices.filter(i=>i.status!=='paid'&&i.dueDate<today)
  const maintDone     = maint.filter(m=>m.resolvedDate===yesterday)
  const maintPending  = maint.filter(m=>m.status!=='done')
  const expiringIn7   = tenants.filter(t=>t.status==='active'&&dLeft(t.checkOutDate)>=0&&dLeft(t.checkOutDate)<=7)
  const newTenants    = tenants.filter(t=>t.checkInDate===today)
  const checkoutToday = tenants.filter(t=>t.checkOutDate===today&&t.status==='active')
  const occupied      = rooms.filter(r=>r.status==='occupied').length
  const occ           = rooms.length > 0 ? Math.round(occupied/rooms.length*100) : 0
  const monthlyRev    = invoices.filter(i=>i.month===thisMonth&&i.status==='paid').reduce((s,i)=>s+i.totalAmount,0)

  const items = []

  // Ringkasan hari ini
  items.push({ icon:'🌅', cat:'Hari Ini', text:`${new Date().toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}` })

  // Tagihan jatuh tempo hari ini
  if (todayDueInvs.length > 0) {
    const names = todayDueInvs.slice(0,3).map(i=>{const t=tenants.find(x=>x.id===i.tenantId);return t?.name?.split(' ')[0]||'?'}).join(', ')
    items.push({ icon:'📅', cat:'Jatuh Tempo Hari Ini', text:`${todayDueInvs.length} tagihan jatuh tempo — ${names}${todayDueInvs.length>3?` +${todayDueInvs.length-3} lainnya`:''}`, alert:true })
  } else {
    items.push({ icon:'✅', cat:'Jatuh Tempo', text:'Tidak ada tagihan jatuh tempo hari ini.' })
  }

  // Pemasukan kemarin
  if (incomeYest > 0) {
    items.push({ icon:'💰', cat:'Pemasukan Kemarin', text:`${fmt(incomeYest)} diterima dari ${paidYesterday.length} pembayaran.` })
  } else {
    items.push({ icon:'💰', cat:'Pemasukan Kemarin', text:'Tidak ada pembayaran masuk kemarin.' })
  }

  // Tagihan menunggak
  if (overdue.length > 0) {
    items.push({ icon:'⚠️', cat:'Menunggak', text:`${overdue.length} tagihan belum dibayar (total ${fmt(overdue.reduce((s,i)=>s+i.totalAmount,0))})`, alert:true })
  }

  // Check-in/out hari ini
  if (newTenants.length > 0) items.push({ icon:'🎉', cat:'Check-in Hari Ini', text:`${newTenants.map(t=>t.name).join(', ')} check-in hari ini.` })
  if (checkoutToday.length > 0) items.push({ icon:'👋', cat:'Check-out Hari Ini', text:`${checkoutToday.map(t=>t.name).join(', ')} check-out hari ini.` })

  // Maintenance kemarin selesai
  if (maintDone.length > 0) {
    items.push({ icon:'🔧', cat:'Maintenance Selesai', text:`${maintDone.map(m=>m.title).join(', ')} diselesaikan kemarin.` })
  }
  if (maintPending.length > 0) {
    items.push({ icon:'🔨', cat:'Maintenance Aktif', text:`${maintPending.length} laporan kerusakan belum selesai.`, alert: maintPending.filter(m=>m.priority==='high').length > 0 })
  }

  // Kontrak akan berakhir
  if (expiringIn7.length > 0) {
    items.push({ icon:'📋', cat:'Kontrak Akan Berakhir', text:`${expiringIn7.map(t=>t.name).join(', ')} kontraknya berakhir dalam 7 hari.`, alert:true })
  }

  // Hunian
  items.push({ icon:'🏠', cat:'Tingkat Hunian', text:`${occupied}/${rooms.length} kamar terisi (${occ}%) — pendapatan bulan ini ${fmt(monthlyRev)}.` })

  return items
}

// ─── PROOF MODAL — Upload Bukti + AI Extract + Approval ─────────────────────
function ProofModal({ inv, tenant, room, prop, allInvoices, tenants, rooms, settings, onConfirm, onClose }) {
  const [step, setStep]           = useState('upload')  // upload|analyzing|matching|result
  const [preview, setPreview]     = useState(null)
  const [base64, setBase64]       = useState(null)
  const [extracted, setExtracted] = useState(null)
  const [error, setError]         = useState('')
  const [payMethod, setPayMethod] = useState('Transfer BCA')
  const [payDate, setPayDate]     = useState(todayStr())
  const [matchedInv, setMatchedInv] = useState(inv)    // invoice yang akan dikonfirmasi
  const fileRef = useRef()
  const camRef  = useRef()

  // Skor kepercayaan AI
  const confidence = extracted ? (() => {
    let s = 0
    if (extracted.amount > 0) s += 40
    if (extracted.date)       s += 25
    if (extracted.bank)       s += 20
    if (extracted.sender)     s += 10
    if (extracted.ref)        s += 5
    return s
  })() : 0
  const CONF_COLOR = confidence >= 70 ? C.grn : confidence >= 40 ? C.amb : C.red
  const CONF_LABEL = confidence >= 70 ? '✅ Akurasi Tinggi' : confidence >= 40 ? '⚠️ Akurasi Sedang' : '❓ Akurasi Rendah'

  // Auto-match: cari semua invoice yang cocok dengan jumlah yang diekstrak
  const candidateMatches = extracted?.amount > 0
    ? (allInvoices||[])
        .filter(i => i.status !== 'paid' && Math.abs(i.totalAmount - extracted.amount) / i.totalAmount <= 0.05)
        .map(i => {
          const t = tenants?.find(x=>x.id===i.tenantId)
          const r = rooms?.find(x=>x.id===i.roomId)
          let score = 60  // amount match base score
          // Bonus: pengirim cocok dengan nama penyewa
          if (extracted.sender && t?.name) {
            const senderLower = extracted.sender.toLowerCase()
            const nameParts = t.name.toLowerCase().split(' ')
            if (nameParts.some(p => p.length > 2 && senderLower.includes(p))) score += 30
          }
          // Bonus: tanggal dekat jatuh tempo
          if (extracted.date && i.dueDate) {
            const diff = Math.abs(new Date(extracted.date) - new Date(i.dueDate)) / 864e5
            score += diff <= 3 ? 15 : diff <= 7 ? 10 : diff <= 14 ? 5 : 0
          }
          const exactAmount = Math.abs(i.totalAmount - extracted.amount) < 1000
          if (exactAmount) score += 10
          return { inv: i, tenant: t, room: r, score }
        })
        .sort((a,b) => b.score - a.score)
    : []

  const amountMatch = matchedInv && extracted?.amount > 0 &&
    Math.abs(extracted.amount - matchedInv.totalAmount) / matchedInv.totalAmount <= 0.05
  const exactMatch = amountMatch && Math.abs(extracted.amount - matchedInv.totalAmount) < 1000

  async function handleFile(file) {
    if (!file) return
    if (file.size > 15*1024*1024) { setError('File terlalu besar (max 15MB)'); return }
    setError('')
    try {
      const { dataUrl, base64: b64 } = await resizeForVision(file)
      setPreview(dataUrl)
      setBase64(b64)
      if (!settings?.visionKey) { setStep('result'); return }
      setStep('analyzing')
      const text = await callVisionAPI(b64, settings.visionKey)
      const parsed = parseTransferText(text)
      setExtracted(parsed)
      if (parsed.date) setPayDate(parsed.date)
      if (parsed.bank) setPayMethod(`Transfer ${parsed.bank}`)
      // Jika ada kandidat match lain yang lebih baik dari current invoice
      setStep(parsed.amount > 0 && candidateMatches.length > 0 ? 'matching' : 'result')
    } catch(e) {
      setError('Gagal analisis: ' + e.message)
      setStep('result')
    }
  }

  // Hitung ulang candidates saat extracted berubah
  const finalCandidates = extracted?.amount > 0
    ? (allInvoices||[])
        .filter(i => i.status !== 'paid' && Math.abs(i.totalAmount - extracted.amount) / i.totalAmount <= 0.05)
        .map(i => {
          const t = tenants?.find(x=>x.id===i.tenantId)
          const r = rooms?.find(x=>x.id===i.roomId)
          let score = 60
          if (extracted.sender && t?.name) {
            const sl = extracted.sender.toLowerCase()
            if (t.name.toLowerCase().split(' ').some(p=>p.length>2&&sl.includes(p))) score += 30
          }
          if (extracted.date && i.dueDate) {
            const diff = Math.abs(new Date(extracted.date)-new Date(i.dueDate))/864e5
            score += diff<=3?15:diff<=7?10:diff<=14?5:0
          }
          if (Math.abs(i.totalAmount-extracted.amount)<1000) score+=10
          return { inv:i, tenant:t, room:r, score }
        })
        .sort((a,b)=>b.score-a.score)
    : []

  function doConfirm() {
    onConfirm({
      invoiceId: matchedInv.id,
      paymentMethod: payMethod,
      payDate: payDate || todayStr(),
      proofImage: base64 ? 'data:image/jpeg;base64,'+base64 : null,
      proofExtracted: extracted,
      confirmedAt: new Date().toISOString()
    })
  }

  return (
    <Modal title="📸 Verifikasi Bukti Transfer" subtitle={`Invoice: ${matchedInv?.invNo} · ${fmt(matchedInv?.totalAmount)}`} onClose={onClose} width={640}>

      {/* STEP: UPLOAD */}
      {step==='upload' && (
        <div>
          {error&&<div style={{background:C.redLt,color:C.red,borderRadius:9,padding:'10px 14px',marginBottom:14,fontSize:13}}>{error}</div>}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
            <div onClick={()=>fileRef.current.click()} style={{border:'2.5px dashed #c7d2fe',borderRadius:14,padding:'28px 16px',textAlign:'center',cursor:'pointer',background:'#fafafe'}}
              onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();handleFile(e.dataTransfer.files[0])}}>
              <div style={{fontSize:36,marginBottom:8}}>🖼️</div>
              <div style={{fontWeight:700,fontSize:13,color:C.txt,marginBottom:4}}>Pilih dari Galeri</div>
              <div style={{fontSize:11,color:C.lite}}>atau drag & drop</div>
              <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={e=>handleFile(e.target.files[0])}/>
            </div>
            <div onClick={()=>camRef.current.click()} style={{border:'2.5px dashed #bbf7d0',borderRadius:14,padding:'28px 16px',textAlign:'center',cursor:'pointer',background:'#f0fdf4'}}>
              <div style={{fontSize:36,marginBottom:8}}>📷</div>
              <div style={{fontWeight:700,fontSize:13,color:C.grn,marginBottom:4}}>Ambil Foto</div>
              <div style={{fontSize:11,color:C.lite}}>Kamera HP / Webcam</div>
              <input ref={camRef} type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={e=>handleFile(e.target.files[0])}/>
            </div>
          </div>
          {!settings?.visionKey&&<div style={{background:C.ambLt,borderRadius:10,padding:'10px 14px',fontSize:12,color:C.amb}}>⚠️ Vision API Key belum diisi → konfirmasi manual. Isi di Pengaturan → AI Bukti Transfer.</div>}
        </div>
      )}

      {/* STEP: ANALYZING */}
      {step==='analyzing'&&(
        <div style={{textAlign:'center',padding:'40px 20px'}}>
          {preview&&<img src={preview} alt="preview" style={{maxHeight:160,maxWidth:'100%',borderRadius:10,marginBottom:16,boxShadow:'0 4px 16px rgba(0,0,0,0.12)'}}/>}
          <Spinner size={40}/>
          <div style={{fontWeight:700,fontSize:15,color:C.txt,marginTop:16,marginBottom:6}}>🤖 AI membaca bukti transfer...</div>
          <div style={{fontSize:13,color:C.mid}}>Mengekstrak nominal, tanggal, bank, dan nama pengirim</div>
        </div>
      )}

      {/* STEP: MATCHING — pilih invoice yang tepat */}
      {step==='matching'&&(
        <div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
            {preview&&<img src={preview} alt="bukti" style={{width:'100%',borderRadius:10,border:`1.5px solid ${C.bdr}`,cursor:'pointer'}} onClick={()=>window.open(preview,'_blank')}/>}
            <div>
              <div style={{fontWeight:700,fontSize:12,color:C.mid,marginBottom:8,textTransform:'uppercase'}}>Hasil AI Ekstraksi</div>
              {[['💰 Nominal',extracted?.amount>0?fmt(extracted.amount):'—'],['📅 Tanggal',extracted?.date||'—'],['🏦 Bank',extracted?.bank||'—'],['👤 Pengirim',extracted?.sender||'—'],['🔖 No. Ref',extracted?.ref||'—']].map(([l,v])=>(
                <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',borderBottom:`1px solid ${C.bdr}`,fontSize:12}}>
                  <span style={{color:C.mid}}>{l}</span><span style={{fontWeight:600,color:C.txt}}>{v}</span>
                </div>
              ))}
              <div style={{marginTop:8,padding:'6px 10px',borderRadius:8,background:CONF_COLOR+'18',fontSize:11,fontWeight:700,color:CONF_COLOR}}>{CONF_LABEL}</div>
            </div>
          </div>

          <div style={{fontWeight:700,fontSize:13,color:C.txt,marginBottom:10}}>🎯 Pilih Invoice yang Tepat</div>
          <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:16}}>
            {finalCandidates.map(({inv:ci,tenant:ct,room:cr,score})=>(
              <div key={ci.id} onClick={()=>setMatchedInv(ci)}
                style={{border:`2px solid ${matchedInv?.id===ci.id?C.grn:C.bdr}`,borderRadius:10,padding:'10px 14px',cursor:'pointer',background:matchedInv?.id===ci.id?C.grnLt:'transparent',transition:'all 0.15s'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:13,color:C.txt}}>{ct?.name||'?'} — {cr?.number||'?'}</div>
                    <div style={{fontSize:11,color:C.mid}}>{ci.invNo} · JT {ci.dueDate} · {fmt(ci.totalAmount)}</div>
                  </div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    <div style={{fontSize:12,fontWeight:700,color:score>=80?C.grn:score>=60?C.amb:C.mid}}>
                      {score>=80?'✅ Sangat cocok':score>=60?'⚠️ Mungkin cocok':'❓ Kurang cocok'}
                    </div>
                    {matchedInv?.id===ci.id&&<div style={{fontSize:10,color:C.grn,fontWeight:700}}>✓ Dipilih</div>}
                  </div>
                </div>
              </div>
            ))}
            {finalCandidates.length===0&&(
              <div style={{background:C.ambLt,borderRadius:10,padding:'12px 14px',fontSize:12,color:C.amb}}>
                ⚠️ Tidak ada invoice pending dengan nominal {fmt(extracted?.amount||0)}. Akan konfirmasi ke invoice saat ini.
              </div>
            )}
          </div>
          <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
            <button style={btnS('ghost','sm')} onClick={()=>{setStep('upload');setPreview(null);setExtracted(null)}}>↩ Upload Ulang</button>
            <button style={btnS('pri')} onClick={()=>setStep('result')}>Lanjut Konfirmasi →</button>
          </div>
        </div>
      )}

      {/* STEP: RESULT — approval screen */}
      {step==='result'&&(
        <div>
          <div style={{display:'grid',gridTemplateColumns:preview?'200px 1fr':'1fr',gap:16,marginBottom:16}}>
            {preview&&(
              <div>
                <div style={{fontSize:11,fontWeight:700,color:C.mid,marginBottom:6,textTransform:'uppercase'}}>Bukti Transfer</div>
                <img src={preview} alt="bukti" style={{width:'100%',borderRadius:10,border:`1.5px solid ${C.bdr}`,cursor:'pointer'}} onClick={()=>window.open(preview,'_blank')}/>
                <div style={{fontSize:9,color:C.lite,marginTop:4,textAlign:'center'}}>Klik untuk perbesar</div>
              </div>
            )}
            <div>
              {extracted&&(
                <>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                    <div style={{fontSize:11,fontWeight:700,color:C.mid,textTransform:'uppercase'}}>Hasil AI</div>
                    <span style={{fontSize:11,fontWeight:700,color:CONF_COLOR,background:CONF_COLOR+'18',padding:'2px 8px',borderRadius:99}}>{CONF_LABEL}</span>
                  </div>
                  {[
                    ['💰 Nominal', extracted.amount>0?fmt(extracted.amount):'—', exactMatch?'✅ Sama persis':amountMatch?'⚠️ Selisih < 5%':extracted.amount>0?'🔴 Beda signifikan':null],
                    ['📅 Tanggal', extracted.date||'—'],['🏦 Bank', extracted.bank||'—'],['👤 Pengirim', extracted.sender||'—'],['🔖 No. Ref', extracted.ref||'—']
                  ].map(([l,v,note])=>(
                    <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:`1px solid ${C.bdr}`,fontSize:12}}>
                      <span style={{color:C.mid}}>{l}</span>
                      <div style={{textAlign:'right'}}>
                        <span style={{fontWeight:v!=='—'?600:400,color:v!=='—'?C.txt:C.lite}}>{v}</span>
                        {note&&<div style={{fontSize:10,color:note.includes('✅')?C.grn:note.includes('⚠️')?C.amb:C.red}}>{note}</div>}
                      </div>
                    </div>
                  ))}
                </>
              )}
              {!extracted&&<div style={{background:C.bg,borderRadius:10,padding:'12px',fontSize:12,color:C.mid}}>📋 Konfirmasi manual — isi detail di bawah</div>}
            </div>
          </div>

          {/* Invoice yang akan dikonfirmasi */}
          <div style={{background:C.priLt,borderRadius:10,padding:'12px 14px',marginBottom:14,fontSize:12}}>
            <div style={{fontWeight:700,color:C.pri,marginBottom:4}}>📋 Invoice yang Dikonfirmasi</div>
            <div style={{color:C.txt}}><b>{tenants?.find(t=>t.id===matchedInv?.tenantId)?.name||tenant?.name||'?'}</b> · {rooms?.find(r=>r.id===matchedInv?.roomId)?.number||room?.number||'?'} · {matchedInv?.invNo} · <b>{fmt(matchedInv?.totalAmount||0)}</b></div>
            {finalCandidates.length>1&&<button style={{...btnS('ghost','sm'),marginTop:6,fontSize:11}} onClick={()=>setStep('matching')}>🔄 Ganti Pilihan</button>}
          </div>

          {/* Warning jika amount tidak cocok */}
          {extracted?.amount>0&&!amountMatch&&(
            <div style={{background:C.redLt,borderRadius:8,padding:'10px 14px',marginBottom:14,fontSize:12,color:C.red}}>
              🚨 <b>Perhatian:</b> Nominal bukti ({fmt(extracted.amount)}) berbeda signifikan dari invoice ({fmt(matchedInv?.totalAmount||0)}). Pastikan ini benar sebelum konfirmasi.
            </div>
          )}

          {/* Form konfirmasi */}
          <div style={{background:C.bg,borderRadius:12,padding:'14px 16px',marginBottom:14}}>
            <div style={{fontWeight:700,fontSize:12,color:C.mid,marginBottom:10,textTransform:'uppercase'}}>✍️ Approval — Konfirmasi Pembayaran</div>
            <FGrid>
              <Sel label="Metode Pembayaran" value={payMethod} onChange={e=>setPayMethod(e.target.value)}>
                {PAY_METHODS.map(m=><option key={m} value={m}>{m}</option>)}
              </Sel>
              <Inp label="Tanggal Bayar" type="date" value={payDate} onChange={e=>setPayDate(e.target.value)}/>
            </FGrid>
          </div>

          <div style={{display:'flex',gap:10,justifyContent:'space-between',flexWrap:'wrap'}}>
            <button style={btnS('ghost','sm')} onClick={()=>{setStep('upload');setPreview(null);setExtracted(null);setBase64(null)}}>↩ Upload Ulang</button>
            <div style={{display:'flex',gap:8}}>
              <button style={btnS('ghost')} onClick={onClose}>Batal</button>
              <button style={btnS('grn')} onClick={doConfirm}>✅ Konfirmasi Lunas</button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}


// ─── KWITANSI DIGITAL VIA WA ──────────────────────────────────────────────────
function sendReceiptWA(inv, tenant, room, prop) {
  const fmtRp = n => 'Rp ' + Number(n||0).toLocaleString('id-ID')
  const getLbl = m => { if(!m)return''; const [y,mo]=m.split('-'); return ['','Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'][+mo]+' '+y }
  const items = (inv.items||[]).map(it => `  • ${it.desc}: ${fmtRp(it.amount)}`).join('\n')
  const msg = [
    `🧾 *KWITANSI PEMBAYARAN*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `📋 No: *${inv.invNo}*`,
    `🏠 Properti: ${prop?.name||''}`,
    `🚪 Kamar: ${room?.number||''}`,
    `👤 Penyewa: *${tenant?.name||''}*`,
    `📅 Periode: ${getLbl(inv.month)}`,
    ``,
    `*RINCIAN:*`,
    items,
    `━━━━━━━━━━━━━━━━━━━━`,
    `💰 *TOTAL: ${fmtRp(inv.totalAmount)}*`,
    inv.status==='paid' ? `✅ Status: *LUNAS*` : `⏳ Status: Belum Lunas`,
    inv.paidDate ? `📆 Tgl Bayar: ${inv.paidDate}` : '',
    inv.paymentMethod ? `💳 Metode: ${inv.paymentMethod}` : '',
    ``,
    prop?.bankName ? `🏦 Rekening: ${prop.bankName} ${prop.bankAccount} a.n. ${prop.bankHolder}` : '',
    ``,
    `Terima kasih 🙏`,
    `— ${prop?.name||'KosManager Pro'}`,
  ].filter(l => l !== null && l !== undefined).join('\n')
  window.open(`https://wa.me/${(tenant?.phone||'').replace(/\D/g,'').replace(/^0/,'62')}?text=${encodeURIComponent(msg)}`, '_blank')
}

// ─── WA TEMPLATES MODAL ───────────────────────────────────────────────────────
function WAModal({ tenant, room, prop, invoices, onClose }) {
  const latest = [...invoices].filter(i=>i.tenantId===tenant.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]
  const templates = [
    { label:'🧾 Tagihan Sewa', msg:`Halo *${tenant.name}*,\n\nTagihan sewa *${mLabel(latest?.month||nowMonth())}*:\n🏠 Kamar: *${room?.number}* — ${prop?.name}\n💰 Jumlah: *${fmt(latest?.totalAmount||tenant.rentAmount)}*\n📅 Jatuh Tempo: *${latest?.dueDate||'-'}*\n\nTransfer ke:\n🏦 ${prop?.bankName} ${prop?.bankAccount}\na.n. ${prop?.bankHolder}\n\nTerima kasih 🙏` },
    { label:'⚠️ Reminder Terlambat', msg:`Halo *${tenant.name}*,\n\nTagihan sewa *${mLabel(latest?.month||nowMonth())}* sebesar *${fmt(latest?.totalAmount||tenant.rentAmount)}* sudah melewati jatuh tempo.\n\nMohon segera bayar ke:\n🏦 ${prop?.bankName} ${prop?.bankAccount}\na.n. ${prop?.bankHolder}\n\nTerima kasih 🙏` },
    { label:'✅ Konfirmasi Lunas', msg:`Halo *${tenant.name}*,\n\nPembayaran sewa ${mLabel(latest?.month||nowMonth())} sebesar *${fmt(latest?.totalAmount||tenant.rentAmount)}* telah kami terima ✓\n\nTerima kasih sudah bayar tepat waktu! 🙏\n— ${prop?.name}` },
    { label:'👋 Selamat Datang', msg:`Selamat datang, *${tenant.name}*! 🎉\n\n🏠 Kamar: ${room?.number}\n📅 Check-in: ${tenant.checkInDate}\n💰 Sewa: ${fmt(tenant.rentAmount)}/${PERIOD_LBL[tenant.rentPeriod]||'Bulan'}\n\nInfo transfer:\n🏦 ${prop?.bankName} ${prop?.bankAccount} a.n. ${prop?.bankHolder}\n\n— Tim ${prop?.name} 🙏` },
    { label:'📢 Perpanjangan Kontrak', msg:`Halo *${tenant.name}*,\n\nKontrak sewa kamar ${room?.number} akan berakhir pada *${tenant.checkOutDate}*.\n\nApakah Anda ingin memperpanjang? Mohon konfirmasi segera 🙏\n— ${prop?.name}` }
  ]
  return (
    <Modal title={`💬 WhatsApp — ${tenant.name}`} subtitle={tenant.phone} onClose={onClose} width={540}>
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {templates.map((t,i) => (
          <div key={i} style={{border:`1px solid ${C.bdr}`,borderRadius:10,padding:'12px 14px'}}>
            <div style={{fontWeight:700,fontSize:12,color:C.mid,marginBottom:6}}>{t.label}</div>
            <div style={{fontSize:12,whiteSpace:'pre-line',color:C.txt,background:C.bg,borderRadius:8,padding:'8px 12px',marginBottom:8,maxHeight:110,overflow:'auto',lineHeight:1.6}}>{t.msg}</div>
            <a href={waUrl(tenant.phone, t.msg)} target="_blank" rel="noreferrer">
              <button style={btnS('wa','sm')}>💬 Buka WhatsApp</button>
            </a>
          </div>
        ))}
      </div>
    </Modal>
  )
}

// ─── FORMS ────────────────────────────────────────────────────────────────────
function PropertyForm({ initial, onSave, onClose }) {
  const df = { name:'',type:'kos',address:'',city:'',phone:'',description:'',bankName:'',bankAccount:'',bankHolder:'',color:'#4f46e5',tariffKwh:1500 }
  const [f, setF] = useState({...df,...initial})
  const [err, setErr] = useState({})
  const s = k => e => setF(p=>({...p,[k]:e.target.value}))
  const COLORS = ['#4f46e5','#0d9488','#d97706','#dc2626','#16a34a','#7c3aed','#db2777','#ea580c','#0369a1','#374151']
  function submit() {
    const e = {}
    if (!f.name.trim()) e.name = 'Wajib diisi'
    if (!f.address.trim()) e.address = 'Wajib diisi'
    if (Object.keys(e).length) { setErr(e); return }
    onSave({...f, id:initial?.id||uid(), createdAt:initial?.createdAt||todayStr()})
  }
  return (
    <div>
      <FGrid><Inp label="Nama Properti" value={f.name} onChange={s('name')} error={err.name} placeholder="Kos Mawar Indah"/><Sel label="Tipe" value={f.type} onChange={s('type')}><option value="kos">Kos</option><option value="apartemen">Apartemen</option><option value="ruko">Ruko</option><option value="villa">Villa</option></Sel></FGrid>
      <div style={{marginBottom:14}}><Txa label="Alamat" value={f.address} onChange={s('address')} error={err.address} rows={2} placeholder="Jl. Mawar No.12, Denpasar"/></div>
      <FGrid><Inp label="Kota" value={f.city} onChange={s('city')} placeholder="Denpasar"/><Inp label="No. Telepon/WA" value={f.phone} onChange={s('phone')} placeholder="08xxx"/></FGrid>
      <div style={{marginBottom:14}}><Txa label="Deskripsi" value={f.description} onChange={s('description')} rows={2}/></div>
      <FGrid cols={3}><Inp label="Bank" value={f.bankName} onChange={s('bankName')} placeholder="BCA"/><Inp label="No. Rekening" value={f.bankAccount} onChange={s('bankAccount')}/><Inp label="Atas Nama" value={f.bankHolder} onChange={s('bankHolder')}/></FGrid>
      <FGrid><Inp label="Tarif Listrik (Rp/kWh)" type="number" value={f.tariffKwh} onChange={s('tariffKwh')} placeholder="1500"/><div/></FGrid>
      <Fld label="Warna Label">
        <div style={{display:'flex',gap:8,flexWrap:'wrap',padding:'8px 0'}}>
          {COLORS.map(c=><div key={c} onClick={()=>setF(p=>({...p,color:c}))} style={{width:30,height:30,borderRadius:999,background:c,cursor:'pointer',border:f.color===c?'3px solid #fff':'3px solid transparent',boxShadow:f.color===c?`0 0 0 2px ${c}`:'none',transition:'all 0.15s'}}/>)}
        </div>
      </Fld>
      <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:8}}>
        <button style={btnS('ghost')} onClick={onClose}>Batal</button>
        <button style={btnS('pri')} onClick={submit}>💾 {initial?'Simpan Perubahan':'Tambah Properti'}</button>
      </div>
    </div>
  )
}

function RoomForm({ initial, props, onSave, onClose }) {
  const df = { propertyId:props[0]?.id||'',number:'',floor:1,type:'Standard',size:'',gender:'campur',pricingPeriods:{daily:0,weekly:0,monthly:0,yearly:0},status:'vacant',facilities:[],maxTenants:1,notes:'',photos:[] }
  const [f, setF] = useState({...df,...initial,pricingPeriods:{...df.pricingPeriods,...initial?.pricingPeriods},photos:initial?.photos||[]})
  const [err, setErr] = useState({})
  const [uploading, setUploading] = useState(false)
  const s = k => e => setF(p=>({...p,[k]:e.target.value}))
  const sP = k => e => setF(p=>({...p,pricingPeriods:{...p.pricingPeriods,[k]:Number(e.target.value)||0}}))
  const togFac = fc => setF(p=>({...p,facilities:p.facilities.includes(fc)?p.facilities.filter(x=>x!==fc):[...p.facilities,fc]}))

  async function handlePhotoUpload(e) {
    const file = e.target.files[0]; if(!file) return
    if (file.size > 10*1024*1024) { showToast('File terlalu besar (max 10MB)','error'); return }
    setUploading(true)
    try {
      const url = await resizeAndUpload(file, `rooms/${f.propertyId}`)
      if (url) setF(p=>({...p,photos:[...(p.photos||[]),url]}))
    } catch(err) { console.error(err) }
    setUploading(false)
    e.target.value = ''
  }

  async function removePhoto(url) {
    setF(p=>({...p,photos:(p.photos||[]).filter(u=>u!==url)}))
    // Extract path from URL for deletion
    try {
      const path = url.split('/km-photos/')[1]
      if (path) await deletePhoto(path)
    } catch(e) {}
  }

  function submit() {
    const e = {}
    if (!f.number.trim()) e.number = 'Wajib diisi'
    if (!f.propertyId) e.propertyId = 'Wajib dipilih'
    if (Object.keys(e).length) { setErr(e); return }
    onSave({...f, floor:Number(f.floor)||1, maxTenants:Number(f.maxTenants)||1, id:initial?.id||uid(), createdAt:initial?.createdAt||todayStr()})
  }

  return (
    <div>
      <FGrid>
        <Sel label="Properti" value={f.propertyId} onChange={s('propertyId')} error={err.propertyId}>{props.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Sel>
        <Inp label="Nomor Kamar" value={f.number} onChange={s('number')} error={err.number} placeholder="A-01"/>
      </FGrid>
      <FGrid cols={3}><Inp label="Lantai" type="number" value={f.floor} onChange={s('floor')} min={1}/><Inp label="Tipe" value={f.type} onChange={s('type')} placeholder="Standard"/><Inp label="Ukuran" value={f.size} onChange={s('size')} placeholder="4×4m"/></FGrid>
      <FGrid>
        <Sel label="Gender" value={f.gender} onChange={s('gender')}><option value="campur">Campur</option><option value="putra">Putra</option><option value="putri">Putri</option></Sel>
        <Sel label="Status" value={f.status} onChange={s('status')}><option value="vacant">Kosong</option><option value="occupied">Terisi</option><option value="maintenance">Maintenance</option><option value="dirty">Perlu Dibersihkan</option></Sel>
      </FGrid>
      <Fld label="Harga Sewa">
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:14}}>
          {['daily','weekly','monthly','yearly'].map(k=>(
            <div key={k}><label style={{fontSize:10,color:C.mid,display:'block',marginBottom:3,fontWeight:600,textTransform:'uppercase'}}>{PERIOD_LBL[k]}</label><input type="number" value={f.pricingPeriods[k]||''} onChange={sP(k)} style={inp()} placeholder="0"/></div>
          ))}
        </div>
      </Fld>
      <FGrid><Inp label="Max Penyewa" type="number" value={f.maxTenants} onChange={s('maxTenants')} min={1}/><Txa label="Catatan" value={f.notes||''} onChange={s('notes')} rows={1} placeholder="Opsional"/></FGrid>
      <Fld label="Fasilitas">
        <div style={{display:'flex',flexWrap:'wrap',gap:6,padding:'6px 0',marginBottom:14}}>
          {FACILITIES.map(fc=><span key={fc} onClick={()=>togFac(fc)} style={{padding:'4px 12px',borderRadius:99,fontSize:12,fontWeight:600,cursor:'pointer',background:f.facilities.includes(fc)?C.pri:C.bg,color:f.facilities.includes(fc)?'#fff':C.mid,border:`1.5px solid ${f.facilities.includes(fc)?C.pri:C.bdr}`,transition:'all 0.15s'}}>{fc}</span>)}
        </div>
      </Fld>
      <Fld label="Foto Kamar (maks. 5 foto)">
        <div style={{display:'flex',gap:8,flexWrap:'wrap',padding:'4px 0',marginBottom:14}}>
          {(f.photos||[]).map((url,i)=>(
            <div key={i} style={{position:'relative',width:80,height:80}}>
              <img src={url} alt="foto" style={{width:80,height:80,objectFit:'cover',borderRadius:8,border:`1.5px solid ${C.bdr}`}}/>
              <button onClick={()=>removePhoto(url)} style={{position:'absolute',top:-6,right:-6,width:20,height:20,borderRadius:99,background:C.red,color:'#fff',border:'none',cursor:'pointer',fontSize:11,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700}}>✕</button>
            </div>
          ))}
          {(f.photos||[]).length < 5 && (
            <label style={{width:80,height:80,borderRadius:8,border:'2px dashed #e2e8f0',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:uploading?'wait':'pointer',color:C.lite,fontSize:11,fontWeight:600,gap:2,background:uploading?C.bg:'#fff'}}>
              <span style={{fontSize:20}}>{uploading?'⏳':'📷'}</span>
              {uploading?'Upload...':'Tambah'}
              <input type="file" accept="image/*" style={{display:'none'}} onChange={handlePhotoUpload} disabled={uploading}/>
            </label>
          )}
        </div>
        <div style={{fontSize:10,color:C.lite}}>Format: JPG/PNG, maks 10MB. Foto disimpan di Supabase Storage.</div>
      </Fld>
      <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
        <button style={btnS('ghost')} onClick={onClose}>Batal</button>
        <button style={btnS('pri')} onClick={submit}>💾 {initial?'Simpan Perubahan':'Tambah Kamar'}</button>
      </div>
    </div>
  )
}

function TenantForm({ initial, props, rooms, onSave, onClose }) {
  const df = { propertyId:props[0]?.id||'',roomId:'',name:'',phone:'',email:'',idNumber:'',gender:'Laki-laki',occupation:'',emergencyContact:'',checkInDate:todayStr(),checkOutDate:'',rentPeriod:'monthly',rentAmount:0,depositAmount:0,depositReturned:0,status:'active',notes:'' }
  const [f, setF] = useState({...df,...initial})
  const [err, setErr] = useState({})
  const s = k => e => setF(p=>({...p,[k]:e.target.value}))
  const availRooms = rooms.filter(r=>r.propertyId===f.propertyId&&(r.status==='vacant'||r.id===initial?.roomId))
  const ktpRef = useRef()
  const [ktpUploading, setKtpUploading] = useState(false)

  async function handleKtpUpload(e) {
    const file = e.target.files[0]; if(!file) return
    if(file.size>10*1024*1024){showToast&&showToast('File max 10MB','error');return}
    setKtpUploading(true)
    const reader = new FileReader()
    reader.onload = ev => { setF(p=>({...p,ktpPhoto:ev.target.result})); setKtpUploading(false) }
    reader.readAsDataURL(file)
    e.target.value=''
  }

  function submit() {
    const e = {}
    if (!f.name.trim()) e.name = 'Wajib diisi'
    if (!f.phone.trim()) e.phone = 'Wajib diisi'
    if (!f.roomId) e.roomId = 'Wajib dipilih'
    if (!f.checkInDate) e.checkInDate = 'Wajib diisi'
    if (!f.checkOutDate) e.checkOutDate = 'Wajib diisi'
    if (f.checkOutDate && f.checkInDate && f.checkOutDate <= f.checkInDate) e.checkOutDate = 'Harus setelah check-in'
    if (Object.keys(e).length) { setErr(e); return }
    onSave({...f, rentAmount:Number(f.rentAmount)||0, depositAmount:Number(f.depositAmount)||0, depositReturned:Number(f.depositReturned)||0, id:initial?.id||uid(), createdAt:initial?.createdAt||todayStr()})
  }
  return (
    <div>
      <FGrid>
        <Sel label="Properti" value={f.propertyId} onChange={e=>setF(p=>({...p,propertyId:e.target.value,roomId:''}))}>{props.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Sel>
        <Sel label="Kamar" value={f.roomId} onChange={s('roomId')} error={err.roomId}><option value="">— Pilih Kamar —</option>{availRooms.map(r=><option key={r.id} value={r.id}>{r.number} ({r.type})</option>)}</Sel>
      </FGrid>
      <FGrid><Inp label="Nama Lengkap" value={f.name} onChange={s('name')} error={err.name} placeholder="Budi Santoso"/><Inp label="No. Telepon/WA" value={f.phone} onChange={s('phone')} error={err.phone} placeholder="081234567890"/></FGrid>
      <FGrid><Inp label="Email" value={f.email} onChange={s('email')} type="email" placeholder="budi@email.com"/><Inp label="No. KTP" value={f.idNumber} onChange={s('idNumber')} placeholder="3171012345670001"/></FGrid>
      <FGrid><Sel label="Jenis Kelamin" value={f.gender} onChange={s('gender')}><option value="Laki-laki">Laki-laki</option><option value="Perempuan">Perempuan</option></Sel><Inp label="Pekerjaan" value={f.occupation} onChange={s('occupation')} placeholder="Mahasiswa"/></FGrid>
      <div style={{marginBottom:14}}><Inp label="Kontak Darurat" value={f.emergencyContact} onChange={s('emergencyContact')} placeholder="Nama - No HP"/></div>
      <FGrid><Inp label="Check-in" type="date" value={f.checkInDate} onChange={s('checkInDate')} error={err.checkInDate}/><Inp label="Check-out (Rencana)" type="date" value={f.checkOutDate} onChange={s('checkOutDate')} error={err.checkOutDate}/></FGrid>
      <FGrid><Sel label="Periode Sewa" value={f.rentPeriod} onChange={s('rentPeriod')}><option value="daily">Harian</option><option value="weekly">Mingguan</option><option value="monthly">Bulanan</option><option value="yearly">Tahunan</option></Sel><Sel label="Status" value={f.status} onChange={s('status')}><option value="active">Aktif</option><option value="checkedout">Check-out</option></Sel></FGrid>
      <FGrid cols={3}><Inp label="Harga Sewa" type="number" value={f.rentAmount} onChange={s('rentAmount')} placeholder="1200000"/><Inp label="Deposit" type="number" value={f.depositAmount} onChange={s('depositAmount')} placeholder="2400000"/><Inp label="Deposit Kembali" type="number" value={f.depositReturned} onChange={s('depositReturned')} placeholder="0"/></FGrid>
      <div style={{marginBottom:14}}><Txa label="Catatan" value={f.notes} onChange={s('notes')} rows={2} placeholder="Opsional..."/></div>

      {/* KTP Photo Upload */}
      <div style={{marginBottom:14}}>
        <label style={{fontSize:11,fontWeight:700,color:C.mid,display:'block',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.04em'}}>📸 Foto KTP (Opsional)</label>
        <div style={{display:'flex',gap:10,alignItems:'flex-start',flexWrap:'wrap'}}>
          {f.ktpPhoto&&(
            <div style={{position:'relative'}}>
              <img src={f.ktpPhoto} alt="KTP" style={{width:140,height:88,objectFit:'cover',borderRadius:8,border:`1.5px solid ${C.bdr}`}}/>
              <button onClick={()=>setF(p=>({...p,ktpPhoto:null}))} style={{position:'absolute',top:-6,right:-6,width:20,height:20,borderRadius:99,background:C.red,color:'#fff',border:'none',cursor:'pointer',fontSize:11,fontWeight:700}}>✕</button>
            </div>
          )}
          <label style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',width:140,height:88,borderRadius:8,border:`2px dashed ${C.bdr}`,cursor:ktpUploading?'wait':'pointer',color:C.lite,fontSize:11,gap:4,background:'transparent'}}>
            <span style={{fontSize:20}}>{ktpUploading?'⏳':'📷'}</span>
            <span>{ktpUploading?'Upload...':f.ktpPhoto?'Ganti Foto':'Upload KTP'}</span>
            <span style={{fontSize:9,color:C.lite}}>JPG/PNG max 10MB</span>
            <input ref={ktpRef} type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={handleKtpUpload} disabled={ktpUploading}/>
          </label>
        </div>
        <div style={{fontSize:10,color:C.lite,marginTop:4}}>Foto KTP tersimpan untuk keperluan verifikasi penyewa.</div>
      </div>

      <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
        <button style={btnS('ghost')} onClick={onClose}>Batal</button>
        <button style={btnS('pri')} onClick={submit}>💾 {initial?'Simpan Perubahan':'Tambah Penyewa'}</button>
      </div>
    </div>
  )
}

function InvoiceForm({ initial, props, rooms, tenants, charges, onSave, onClose }) {
  const activeTenants = tenants.filter(t=>t.status==='active')
  const [f, setF] = useState(()=>{
    if (initial) return {...initial}
    return { tenantId:activeTenants[0]?.id||'', month:nowMonth(), dueDate:'', items:[], paymentMethod:'', notes:'' }
  })
  const [err, setErr] = useState({})
  const tenant = tenants.find(t=>t.id===f.tenantId)
  const room   = rooms.find(r=>r.id===tenant?.roomId)
  const prop   = props.find(p=>p.id===tenant?.propertyId)
  const unbilled = charges.filter(c=>c.tenantId===f.tenantId&&!c.billed)

  useEffect(()=>{
    if (!tenant || initial) return
    const desc = `Sewa ${room?.number||''} - ${mLabel(f.month)}`
    setF(p=>({...p,items:[{desc,qty:1,unitPrice:tenant.rentAmount||0,amount:tenant.rentAmount||0}],propertyId:tenant.propertyId,roomId:tenant.roomId}))
  },[f.tenantId,f.month])

  const addItem = () => setF(p=>({...p,items:[...p.items,{desc:'',qty:1,unitPrice:0,amount:0}]}))
  const removeItem = i => setF(p=>({...p,items:p.items.filter((_,idx)=>idx!==i)}))
  const setItem = (i,k,v) => setF(p=>({...p,items:p.items.map((it,idx)=>{
    if(idx!==i)return it
    const n = {...it,[k]:k==='desc'?v:Number(v)||0}
    if(k==='qty'||k==='unitPrice') n.amount = n.qty*n.unitPrice
    return n
  })}))
  const total = f.items.reduce((s,it)=>s+(it.amount||0),0)

  function submit() {
    const e = {}
    if (!f.tenantId) e.tenantId = 'Pilih penyewa'
    if (!f.month) e.month = 'Pilih bulan'
    if (!f.dueDate) e.dueDate = 'Wajib diisi'
    if (f.items.length===0) e.items = 'Tambah minimal 1 item'
    if (Object.keys(e).length) { setErr(e); return }
    const m = (f.month||nowMonth()).replace('-','')
    onSave({...f, totalAmount:total, invNo:initial?.invNo||`INV-${m}-${Math.floor(1000+Math.random()*9000)}`, status:initial?.status||'unpaid', paidDate:initial?.paidDate||null, propertyId:tenant?.propertyId||'', roomId:tenant?.roomId||'', id:initial?.id||uid(), createdAt:initial?.createdAt||todayStr()})
  }

  return (
    <div>
      <FGrid>
        <Sel label="Penyewa" value={f.tenantId} onChange={e=>setF(p=>({...p,tenantId:e.target.value}))} error={err.tenantId}><option value="">— Pilih Penyewa —</option>{activeTenants.map(t=><option key={t.id} value={t.id}>{t.name} ({rooms.find(r=>r.id===t.roomId)?.number||'?'})</option>)}</Sel>
        <Inp label="Bulan" type="month" value={f.month} onChange={e=>setF(p=>({...p,month:e.target.value}))} error={err.month}/>
      </FGrid>
      <FGrid>
        <Inp label="Jatuh Tempo" type="date" value={f.dueDate} onChange={e=>setF(p=>({...p,dueDate:e.target.value}))} error={err.dueDate}/>
        <Sel label="Metode Bayar" value={f.paymentMethod||''} onChange={e=>setF(p=>({...p,paymentMethod:e.target.value}))}><option value="">— Pilih —</option>{PAY_METHODS.map(m=><option key={m} value={m}>{m}</option>)}</Sel>
      </FGrid>
      {tenant&&prop&&<div style={{background:C.priLt,borderRadius:10,padding:'10px 14px',marginBottom:14,fontSize:12,color:C.pri}}><b>{tenant.name}</b> · {room?.number} · {prop.name} · {prop.bankName} {prop.bankAccount}</div>}
      {unbilled.length>0&&<div style={{background:C.ambLt,borderRadius:10,padding:'10px 14px',marginBottom:14}}>
        <div style={{fontSize:11,fontWeight:700,color:C.amb,marginBottom:8}}>BIAYA TAMBAHAN BELUM DITAGIH</div>
        {unbilled.map(c=><div key={c.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
          <span style={{fontSize:12}}>{c.description} · {fmt(c.amount)}</span>
          <button style={btnS('amb','sm')} onClick={()=>setF(p=>({...p,items:[...p.items,{desc:c.description,qty:1,unitPrice:c.amount,amount:c.amount,chargeId:c.id}]}))}>+ Tambah</button>
        </div>)}
      </div>}
      <div style={{marginBottom:14}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <label style={{fontSize:11,fontWeight:700,color:C.mid,textTransform:'uppercase',letterSpacing:'0.04em'}}>Item Tagihan{err.items&&<span style={{color:C.red,marginLeft:6,fontWeight:400,textTransform:'none'}}>{err.items}</span>}</label>
          <button style={btnS('ghost','sm')} onClick={addItem}>+ Tambah Item</button>
        </div>
        {f.items.map((it,i)=>(
          <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 60px 110px 30px',gap:6,marginBottom:6,alignItems:'center'}}>
            <input value={it.desc} onChange={e=>setItem(i,'desc',e.target.value)} style={inp()} placeholder="Deskripsi"/>
            <input type="number" value={it.qty} onChange={e=>setItem(i,'qty',e.target.value)} style={inp()} min={1}/>
            <input type="number" value={it.unitPrice} onChange={e=>setItem(i,'unitPrice',e.target.value)} style={inp()} placeholder="Harga"/>
            <button style={{...btnS('red','sm'),padding:'4px 8px'}} onClick={()=>removeItem(i)}>✕</button>
          </div>
        ))}
      </div>
      <div style={{textAlign:'right',fontWeight:800,fontSize:15,color:C.txt,marginBottom:14}}>Total: {fmt(total)}</div>
      <Txa label="Catatan" value={f.notes||''} onChange={e=>setF(p=>({...p,notes:e.target.value}))} rows={2} placeholder="Opsional..."/>
      <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:8}}>
        <button style={btnS('ghost')} onClick={onClose}>Batal</button>
        <button style={btnS('pri')} onClick={submit}>💾 {initial?'Simpan Perubahan':'Buat Tagihan'}</button>
      </div>
    </div>
  )
}

function ExpenseForm({ initial, props, onSave, onClose }) {
  const df = { propertyId:props[0]?.id||'',category:'Listrik',description:'',amount:0,date:todayStr(),isRecurring:false,recurringDay:1,status:'unpaid',notes:'' }
  const [f, setF] = useState({...df,...initial})
  const [err, setErr] = useState({})
  const s = k => e => setF(p=>({...p,[k]:e.target.value}))
  function submit() {
    const e = {}
    if (!f.description.trim()) e.description = 'Wajib diisi'
    if (!f.amount||Number(f.amount)<=0) e.amount = 'Harus > 0'
    if (Object.keys(e).length) { setErr(e); return }
    onSave({...f, amount:Number(f.amount)||0, isRecurring:!!f.isRecurring, recurringDay:f.isRecurring?Number(f.recurringDay)||1:null, id:initial?.id||uid(), createdAt:initial?.createdAt||todayStr()})
  }
  return (
    <div>
      <FGrid><Sel label="Properti" value={f.propertyId} onChange={s('propertyId')}>{props.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Sel><Sel label="Kategori" value={f.category} onChange={s('category')}>{EXPENSE_CATS.map(c=><option key={c} value={c}>{c}</option>)}</Sel></FGrid>
      <div style={{marginBottom:14}}><Inp label="Deskripsi" value={f.description} onChange={s('description')} error={err.description} placeholder="PLN Maret 2026"/></div>
      <FGrid><Inp label="Jumlah (Rp)" type="number" value={f.amount} onChange={s('amount')} error={err.amount} placeholder="500000"/><Inp label="Tanggal" type="date" value={f.date} onChange={s('date')}/></FGrid>
      <FGrid><Sel label="Status" value={f.status} onChange={s('status')}><option value="unpaid">Belum Bayar</option><option value="paid">Lunas</option></Sel><Sel label="Rutin?" value={f.isRecurring?'yes':'no'} onChange={e=>setF(p=>({...p,isRecurring:e.target.value==='yes'}))}><option value="no">Tidak Rutin</option><option value="yes">Rutin Tiap Bulan</option></Sel></FGrid>
      {f.isRecurring&&<div style={{marginBottom:14}}><Inp label="Tanggal Berulang (tgl berapa tiap bulan)" type="number" value={f.recurringDay} onChange={s('recurringDay')} min={1} max={31}/></div>}
      <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
        <button style={btnS('ghost')} onClick={onClose}>Batal</button>
        <button style={btnS('pri')} onClick={submit}>💾 {initial?'Simpan Perubahan':'Tambah Pengeluaran'}</button>
      </div>
    </div>
  )
}

function MaintenanceForm({ initial, props, rooms, tenants, onSave, onClose }) {
  const df = { propertyId:props[0]?.id||'',roomId:'',tenantId:'',category:'AC',title:'',description:'',priority:'medium',status:'pending',vendor:'',vendorPhone:'',estimateCost:0,actualCost:0,reportedDate:todayStr(),resolvedDate:'',notes:'' }
  const [f, setF] = useState({...df,...initial})
  const [err, setErr] = useState({})
  const s = k => e => setF(p=>({...p,[k]:e.target.value}))
  function submit() {
    const e = {}
    if (!f.title.trim()) e.title = 'Wajib diisi'
    if (Object.keys(e).length) { setErr(e); return }
    onSave({...f, estimateCost:Number(f.estimateCost)||0, actualCost:Number(f.actualCost)||0, id:initial?.id||uid(), createdAt:initial?.createdAt||todayStr()})
  }
  return (
    <div>
      <FGrid>
        <Sel label="Properti" value={f.propertyId} onChange={e=>setF(p=>({...p,propertyId:e.target.value,roomId:'',tenantId:''}))}>{props.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Sel>
        <Sel label="Kamar (Opsional)" value={f.roomId} onChange={s('roomId')}><option value="">— Pilih —</option>{rooms.filter(r=>r.propertyId===f.propertyId).map(r=><option key={r.id} value={r.id}>{r.number}</option>)}</Sel>
      </FGrid>
      <FGrid>
        <Sel label="Kategori" value={f.category} onChange={s('category')}>{MAINT_CATS.map(c=><option key={c} value={c}>{c}</option>)}</Sel>
        <Sel label="Prioritas" value={f.priority} onChange={s('priority')}><option value="low">Rendah</option><option value="medium">Sedang</option><option value="high">Tinggi</option></Sel>
      </FGrid>
      <div style={{marginBottom:14}}><Inp label="Judul Masalah" value={f.title} onChange={s('title')} error={err.title} placeholder="AC tidak dingin di kamar A-01"/></div>
      <div style={{marginBottom:14}}><Txa label="Deskripsi" value={f.description} onChange={s('description')} rows={2} placeholder="Detail masalah..."/></div>
      <FGrid><Sel label="Status" value={f.status} onChange={s('status')}><option value="pending">Menunggu</option><option value="inprogress">Dikerjakan</option><option value="done">Selesai</option></Sel><Inp label="Tanggal Laporan" type="date" value={f.reportedDate} onChange={s('reportedDate')}/></FGrid>
      <FGrid><Inp label="Vendor/Teknisi" value={f.vendor} onChange={s('vendor')} placeholder="Service AC Pak Budi"/><Inp label="No. Telepon Vendor" value={f.vendorPhone} onChange={s('vendorPhone')} placeholder="08xxx"/></FGrid>
      <FGrid cols={3}><Inp label="Estimasi Biaya" type="number" value={f.estimateCost} onChange={s('estimateCost')}/><Inp label="Biaya Aktual" type="number" value={f.actualCost} onChange={s('actualCost')}/><Inp label="Tgl Selesai" type="date" value={f.resolvedDate||''} onChange={s('resolvedDate')}/></FGrid>
      <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
        <button style={btnS('ghost')} onClick={onClose}>Batal</button>
        <button style={btnS('pri')} onClick={submit}>💾 {initial?'Simpan':'Buat Laporan'}</button>
      </div>
    </div>
  )
}

function MeterForm({ initial, props, rooms, tenants, onSave, onClose }) {
  const activeT = tenants.filter(t=>t.status==='active')
  const df = { propertyId:props[0]?.id||'',roomId:'',tenantId:'',month:nowMonth(),kwStart:0,kwEnd:0,tariff:props[0]?.tariffKwh||1500,notes:'' }
  const [f, setF] = useState({...df,...initial})
  const [err, setErr] = useState({})
  const s = k => e => setF(p=>({...p,[k]:e.target.value}))
  const kwUsed = Math.max(0,(Number(f.kwEnd)||0)-(Number(f.kwStart)||0))
  const total  = kwUsed*(Number(f.tariff)||1500)
  const propRooms = rooms.filter(r=>r.propertyId===f.propertyId&&r.status==='occupied')
  function submit() {
    const e = {}
    if (!f.roomId) e.roomId = 'Pilih kamar'
    if (Number(f.kwEnd)<Number(f.kwStart)) e.kwEnd = 'Meter akhir < awal'
    if (Object.keys(e).length) { setErr(e); return }
    onSave({...f, kwStart:Number(f.kwStart)||0, kwEnd:Number(f.kwEnd)||0, kwUsed, tariff:Number(f.tariff)||1500, totalAmount:total, billed:initial?.billed||false, invoiceId:initial?.invoiceId||null, id:initial?.id||uid(), createdAt:initial?.createdAt||todayStr()})
  }
  return (
    <div>
      <FGrid>
        <Sel label="Properti" value={f.propertyId} onChange={e=>{ const p2=props.find(p=>p.id===e.target.value); setF(p=>({...p,propertyId:e.target.value,roomId:'',tenantId:'',tariff:p2?.tariffKwh||1500})) }}>{props.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Sel>
        <Sel label="Kamar" value={f.roomId} onChange={e=>{ const t=activeT.find(t=>t.roomId===e.target.value); setF(p=>({...p,roomId:e.target.value,tenantId:t?.id||''})) }} error={err.roomId}><option value="">— Pilih Kamar —</option>{propRooms.map(r=><option key={r.id} value={r.id}>{r.number}</option>)}</Sel>
      </FGrid>
      <FGrid><Inp label="Bulan" type="month" value={f.month} onChange={s('month')}/><Inp label="Tarif (Rp/kWh)" type="number" value={f.tariff} onChange={s('tariff')}/></FGrid>
      <FGrid><Inp label="Stand Awal (kWh)" type="number" value={f.kwStart} onChange={s('kwStart')} placeholder="1250"/><Inp label="Stand Akhir (kWh)" type="number" value={f.kwEnd} onChange={s('kwEnd')} error={err.kwEnd} placeholder="1320"/></FGrid>
      {kwUsed>0&&<div style={{background:C.priLt,borderRadius:10,padding:'12px 16px',marginBottom:14,display:'flex',gap:24}}>
        <div><div style={{fontSize:11,color:C.mid,fontWeight:600}}>Pemakaian</div><div style={{fontSize:18,fontWeight:800,color:C.pri}}>{kwUsed} kWh</div></div>
        <div><div style={{fontSize:11,color:C.mid,fontWeight:600}}>Total Tagihan</div><div style={{fontSize:18,fontWeight:800,color:C.grn}}>{fmt(total)}</div></div>
      </div>}
      <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
        <button style={btnS('ghost')} onClick={onClose}>Batal</button>
        <button style={btnS('pri')} onClick={submit}>💾 {initial?'Simpan':'Catat Meteran'}</button>
      </div>
    </div>
  )
}

// ─── VIEWS ────────────────────────────────────────────────────────────────────
function DashboardView({ data, actions, setPage, showToast }) {
  const { props, rooms, tenants, invoices, expenses, maint } = data
  const today = todayStr(), thisMonth = nowMonth()
  const occupied      = rooms.filter(r=>r.status==='occupied').length
  const occupancy     = rooms.length>0 ? Math.round(occupied/rooms.length*100) : 0
  const overdueInv    = invoices.filter(i=>i.status==='overdue'||(i.status==='unpaid'&&i.dueDate<today))
  const overdueAmt    = overdueInv.reduce((s,i)=>s+i.totalAmount,0)
  const thisMonthRev  = invoices.filter(i=>i.month===thisMonth&&i.status==='paid').reduce((s,i)=>s+i.totalAmount,0)
  const thisMonthExp  = expenses.filter(e=>e.date.startsWith(thisMonth)).reduce((s,e)=>s+e.amount,0)
  const pendingMaint  = maint.filter(m=>m.status!=='done').length
  const expiringIn30  = tenants.filter(t=>t.status==='active'&&dLeft(t.checkOutDate)<=30&&dLeft(t.checkOutDate)>0)

  const months = Array.from({length:6},(_,i)=>{ const d=new Date();d.setMonth(d.getMonth()-(5-i));return d.toISOString().slice(0,7) })
  const chartData = months.map(m=>({
    label: mLabel(m),
    rev: invoices.filter(i=>i.month===m&&i.status==='paid').reduce((s,i)=>s+i.totalAmount,0),
    exp: expenses.filter(e=>e.date.startsWith(m)).reduce((s,e)=>s+e.amount,0)
  }))
  const maxVal = Math.max(...chartData.flatMap(d=>[d.rev,d.exp]),1)

  async function bulkWA() {
    const token = data.settings?.fonnteToken
    if (!token) { showToast('Setup Fonnte Token di Pengaturan → WA Otomatis dulu','error'); return }
    let sent = 0
    for (const inv of overdueInv.slice(0,10)) {
      const t = tenants.find(x=>x.id===inv.tenantId)
      const p = props.find(x=>x.id===inv.propertyId)
      if (!t?.phone) continue
      const msg = `Halo ${t.name}, tagihan sewa ${mLabel(inv.month)} sebesar ${fmt(inv.totalAmount)} sudah jatuh tempo. Mohon segera bayarkan ke ${p?.bankName||''} ${p?.bankAccount||''}. Terima kasih 🙏`
      const ok = await sendFonnte(token, t.phone, msg)
      if (ok) sent++
      await new Promise(r=>setTimeout(r,1500))
    }
    showToast(`${sent} reminder WA terkirim ✓`)
  }

  return (
    <div>
      <div style={{marginBottom:20}}>
        <h1 style={{margin:0,fontSize:22,fontWeight:800,color:C.txt}}>Dashboard</h1>
        <p style={{margin:'4px 0 0',fontSize:13,color:C.mid}}>{new Date().toLocaleDateString('id-ID',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12,marginBottom:20}}>
        <StatCard icon="🏠" label="Kamar Terisi" value={`${occupied}/${rooms.length}`} sub={`${occupancy}% hunian`} accent={C.pri}/>
        <StatCard icon="👥" label="Penyewa Aktif" value={tenants.filter(t=>t.status==='active').length} sub={`${rooms.length-occupied} kamar kosong`} accent={C.teal}/>
        <StatCard icon="💰" label={`Pendapatan ${mLabel(thisMonth)}`} value={short(thisMonthRev)} sub={`Exp: ${short(thisMonthExp)} · Laba: ${short(thisMonthRev-thisMonthExp)}`} accent={C.grn}/>
        <StatCard icon="⚠️" label="Tagihan Terlambat" value={overdueInv.length} sub={fmt(overdueAmt)} accent={C.red} onClick={()=>setPage('invoices')}/>
        <StatCard icon="🔧" label="Maintenance Aktif" value={pendingMaint} sub={pendingMaint>0?'Perlu perhatian':'Semua beres'} accent={C.amb} onClick={()=>setPage('maintenance')}/>
        <StatCard icon="📋" label="Kontrak Berakhir" value={expiringIn30.length} sub="Dalam 30 hari" accent="#7c3aed" onClick={()=>setPage('tenants')}/>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:16,marginBottom:20}}>
        {/* Chart */}
        <div style={{...CS.card,padding:20}}>
          <div style={{fontWeight:700,fontSize:14,color:C.txt,marginBottom:16}}>📊 6 Bulan Terakhir</div>
          <div style={{display:'flex',alignItems:'flex-end',gap:6,height:120}}>
            {chartData.map((d,i)=>(
              <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
                <div style={{width:'100%',display:'flex',gap:2,alignItems:'flex-end',height:100}}>
                  <div title={`Rev: ${fmt(d.rev)}`} style={{flex:1,background:`${C.pri}bb`,borderRadius:'4px 4px 0 0',height:maxVal>0?`${d.rev/maxVal*100}%`:'2px',minHeight:2,transition:'height 0.4s',cursor:'default'}}/>
                  <div title={`Exp: ${fmt(d.exp)}`} style={{flex:1,background:`${C.red}88`,borderRadius:'4px 4px 0 0',height:maxVal>0?`${d.exp/maxVal*100}%`:'2px',minHeight:2,transition:'height 0.4s',cursor:'default'}}/>
                </div>
                <div style={{fontSize:9,color:C.lite,whiteSpace:'nowrap'}}>{d.label}</div>
              </div>
            ))}
          </div>
          <div style={{display:'flex',gap:16,marginTop:8}}>
            <div style={{display:'flex',alignItems:'center',gap:4,fontSize:11,color:C.mid}}><div style={{width:10,height:10,background:`${C.pri}bb`,borderRadius:2}}/> Pendapatan</div>
            <div style={{display:'flex',alignItems:'center',gap:4,fontSize:11,color:C.mid}}><div style={{width:10,height:10,background:`${C.red}88`,borderRadius:2}}/> Pengeluaran</div>
          </div>
        </div>
        {/* Per Properti */}
        <div style={{...CS.card,padding:20}}>
          <div style={{fontWeight:700,fontSize:14,color:C.txt,marginBottom:16}}>🏘️ Per Properti — {mLabel(thisMonth)}</div>
          {props.map(p=>{
            const pRooms=rooms.filter(r=>r.propertyId===p.id), occ=pRooms.filter(r=>r.status==='occupied').length
            const rev=invoices.filter(i=>i.propertyId===p.id&&i.month===thisMonth&&i.status==='paid').reduce((s,i)=>s+i.totalAmount,0)
            const exp=expenses.filter(e=>e.propertyId===p.id&&e.date.startsWith(thisMonth)).reduce((s,e)=>s+e.amount,0)
            const profit=rev-exp, pct=pRooms.length?Math.round(occ/pRooms.length*100):0
            return <div key={p.id} style={{marginBottom:12}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                <div style={{display:'flex',alignItems:'center',gap:6}}><div style={{width:10,height:10,borderRadius:99,background:p.color||C.pri}}/><span style={{fontSize:13,fontWeight:600}}>{p.name}</span></div>
                <span style={{fontSize:12,fontWeight:700,color:profit>=0?C.grn:C.red}}>{short(profit)}</span>
              </div>
              <div style={{height:6,background:C.bg,borderRadius:99,overflow:'hidden'}}><div style={{height:'100%',width:`${pct}%`,background:p.color||C.pri,borderRadius:99,transition:'width 0.4s'}}/></div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:C.lite,marginTop:2}}><span>{occ}/{pRooms.length} kamar ({pct}%)</span><span>Rev: {short(rev)} · Exp: {short(exp)}</span></div>
            </div>
          })}
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:16}}>
        {/* Overdue */}
        <div style={{...CS.card,padding:20}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <div style={{fontWeight:700,fontSize:14,color:C.txt}}>🚨 Tagihan Terlambat ({overdueInv.length})</div>
            {overdueInv.length>0&&<button style={btnS('wa','sm')} onClick={bulkWA}>💬 Kirim Semua WA</button>}
          </div>
          {overdueInv.length===0&&<Empty icon="✅" title="Semua tagihan lunas"/>}
          {overdueInv.slice(0,5).map(inv=>{
            const t=tenants.find(x=>x.id===inv.tenantId), r=rooms.find(x=>x.id===inv.roomId)
            const p=props.find(x=>x.id===inv.propertyId)
            return <div key={inv.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:`1px solid ${C.bdr}`}}>
              <div><div style={{fontSize:13,fontWeight:600,color:C.txt}}>{t?.name||'—'}</div><div style={{fontSize:11,color:C.mid}}>{r?.number} · {mLabel(inv.month)} · JT {inv.dueDate}</div></div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:13,fontWeight:700,color:C.red}}>{fmt(inv.totalAmount)}</div>
                {t&&<a href={waUrl(t.phone,`Halo ${t.name}, tagihan sewa ${mLabel(inv.month)} ${fmt(inv.totalAmount)} sudah jatuh tempo. Mohon segera bayarkan ke ${p?.bankName} ${p?.bankAccount}. Terima kasih 🙏`)} target="_blank" rel="noreferrer"><button style={{...btnS('wa','sm'),marginTop:2}}>💬</button></a>}
              </div>
            </div>
          })}
        </div>
        {/* Expiring contracts */}
        <div style={{...CS.card,padding:20}}>
          <div style={{fontWeight:700,fontSize:14,color:C.txt,marginBottom:12}}>📅 Kontrak Akan Berakhir</div>
          {expiringIn30.length===0&&<Empty icon="✅" title="Tidak ada kontrak berakhir dalam 30 hari"/>}
          {expiringIn30.map(t=>{
            const r=rooms.find(x=>x.id===t.roomId), dl=dLeft(t.checkOutDate)
            return <div key={t.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:`1px solid ${C.bdr}`}}>
              <div><div style={{fontSize:13,fontWeight:600,color:C.txt}}>{t.name}</div><div style={{fontSize:11,color:C.mid}}>{r?.number||'—'} · s/d {t.checkOutDate}</div></div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:12,fontWeight:700,color:dl<=7?C.red:C.amb}}>{dl} hari lagi</div>
                <a href={waUrl(t.phone,`Halo ${t.name}, kontrak sewa kamar ${r?.number||''} akan berakhir pada ${t.checkOutDate}. Apakah ingin diperpanjang? Mohon konfirmasi 🙏`)} target="_blank" rel="noreferrer"><button style={{...btnS('wa','sm'),marginTop:2}}>💬</button></a>
              </div>
            </div>
          })}
        </div>
      </div>
    </div>
  )
}

function PropertiesView({ data, actions, showToast }) {
  const { props, rooms, tenants, invoices } = data
  const [modal, setModal] = useState(null)
  const [del, setDel] = useState(null)
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
        <div><h1 style={{margin:0,fontSize:22,fontWeight:800}}>Properti</h1><p style={{margin:'4px 0 0',fontSize:13,color:C.mid}}>{props.length} properti terdaftar</p></div>
        <button style={btnS('pri')} onClick={()=>setModal({})}>＋ Tambah Properti</button>
      </div>
      {props.length===0&&<Empty icon="🏠" title="Belum ada properti" sub="Klik tombol Tambah untuk mulai"/>}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:16}}>
        {props.map(p=>{
          const pRooms=rooms.filter(r=>r.propertyId===p.id), occ=pRooms.filter(r=>r.status==='occupied').length
          const rev=invoices.filter(i=>i.propertyId===p.id&&i.month===nowMonth()&&i.status==='paid').reduce((s,i)=>s+i.totalAmount,0)
          return <div key={p.id} style={{...CS.card,overflow:'hidden'}}>
            <div style={{height:6,background:p.color||C.pri}}/>
            <div style={{padding:'16px 18px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                <div><div style={{fontSize:15,fontWeight:800,color:C.txt}}>{p.name}</div><div style={{fontSize:11,color:C.mid,marginTop:2}}>{p.address}</div></div>
                <Badge s={p.type}/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:12}}>
                <div style={{background:C.bg,borderRadius:8,padding:'8px',textAlign:'center'}}><div style={{fontSize:17,fontWeight:800,color:C.pri}}>{occ}/{pRooms.length}</div><div style={{fontSize:10,color:C.mid}}>Terisi</div></div>
                <div style={{background:C.bg,borderRadius:8,padding:'8px',textAlign:'center'}}><div style={{fontSize:17,fontWeight:800,color:C.teal}}>{tenants.filter(t=>t.propertyId===p.id&&t.status==='active').length}</div><div style={{fontSize:10,color:C.mid}}>Penyewa</div></div>
                <div style={{background:C.bg,borderRadius:8,padding:'8px',textAlign:'center'}}><div style={{fontSize:13,fontWeight:800,color:C.grn}}>{short(rev)}</div><div style={{fontSize:10,color:C.mid}}>Rev. Bln Ini</div></div>
              </div>
              {p.bankName&&<div style={{fontSize:11,color:C.mid,marginBottom:10}}>🏦 {p.bankName} {p.bankAccount} · {p.bankHolder}</div>}
              <div style={{display:'flex',gap:8}}>
                <button style={btnS('ghost','sm')} onClick={()=>setModal(p)}>✏️ Edit</button>
                <button style={btnS('red','sm')} onClick={()=>setDel(p)}>🗑️ Hapus</button>
              </div>
            </div>
          </div>
        })}
      </div>
      {modal!==null&&<Modal title={modal.id?'Edit Properti':'Tambah Properti'} onClose={()=>setModal(null)} width={600}><PropertyForm initial={modal.id?modal:null} onSave={async d=>{await actions.saveProperty(d);setModal(null);showToast('Properti disimpan ✓')}} onClose={()=>setModal(null)}/></Modal>}
      {del&&<Confirm msg={`Hapus "${del.name}"?`} onYes={async()=>{await actions.deleteProperty(del.id);setDel(null);showToast('Properti dihapus','warn')}} onNo={()=>setDel(null)}/>}
    </div>
  )
}

function RoomsView({ data, actions, showToast }) {
  const { props, rooms, tenants } = data
  const [modal, setModal]           = useState(null)
  const [del, setDel]               = useState(null)
  const [historyRoom, setHistoryRoom] = useState(null)
  const [bulkAddOpen, setBulkAddOpen] = useState(false)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [filterProp, setFilterProp] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [search, setSearch] = useState('')
  const filtered = rooms.filter(r=>{
    if (filterProp!=='all'&&r.propertyId!==filterProp) return false
    if (filterStatus!=='all'&&r.status!==filterStatus) return false
    if (search&&!r.number.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
        <div><h1 style={{margin:0,fontSize:22,fontWeight:800}}>Kamar & Unit</h1><p style={{margin:'4px 0 0',fontSize:13,color:C.mid}}>{filtered.length}/{rooms.length} kamar</p></div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <button style={btnS('ghost','sm')} onClick={()=>setBulkEditOpen(true)}>✏️ Bulk Edit</button>
          <button style={btnS('teal','sm')} onClick={()=>setBulkAddOpen(true)}>➕ Bulk Add</button>
          <button style={btnS('pri')} onClick={()=>setModal({})}>＋ Tambah Kamar</button>
        </div>
      </div>
      <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:16}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} style={{...inp(),width:200,flex:'none'}} placeholder="🔍 Cari nomor kamar..."/>
        <select value={filterProp} onChange={e=>setFilterProp(e.target.value)} style={{...inp(),width:'auto',flex:'none'}}><option value="all">Semua Properti</option>{props.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{...inp(),width:'auto',flex:'none'}}>
          <option value="all">Semua Status</option><option value="vacant">Kosong ({rooms.filter(r=>r.status==='vacant').length})</option><option value="occupied">Terisi ({rooms.filter(r=>r.status==='occupied').length})</option><option value="maintenance">Maintenance</option><option value="dirty">Perlu Dibersihkan</option>
        </select>
      </div>
      {filtered.length===0&&<Empty icon="🚪" title="Tidak ada kamar" sub="Ubah filter atau tambah kamar baru"/>}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:12}}>
        {filtered.map(r=>{
          const prop=props.find(p=>p.id===r.propertyId), tenant=tenants.find(t=>t.roomId===r.id&&t.status==='active')
          return <div key={r.id} style={{...CS.card,padding:'14px 16px'}}>
            {(r.photos||[]).length>0&&<div style={{display:'flex',gap:4,marginBottom:10,overflowX:'auto'}}>{r.photos.map((url,i)=><img key={i} src={url} alt="foto" style={{width:64,height:64,objectFit:'cover',borderRadius:8,border:`1.5px solid ${C.bdr}`,flexShrink:0}}/>)}</div>}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}>
              <div><div style={{fontSize:16,fontWeight:800,color:C.txt}}>Kamar {r.number}</div><div style={{fontSize:11,color:C.mid}}>{prop?.name||'—'} · Lt.{r.floor}</div></div>
              <Badge s={r.status}/>
            </div>
            <div style={{fontSize:12,color:C.mid,marginBottom:6}}>{r.type} · {r.size} · {r.gender==='campur'?'Campur':r.gender==='putra'?'Putra':'Putri'}</div>
            {tenant&&<div style={{background:C.priLt,borderRadius:8,padding:'6px 10px',marginBottom:6,fontSize:12,color:C.pri}}>👤 {tenant.name} · s/d {tenant.checkOutDate}</div>}
            <div style={{fontSize:12,fontWeight:700,color:C.grn,marginBottom:8}}>{fmt(r.pricingPeriods?.monthly||0)}/bln</div>
            {(r.facilities||[]).length>0&&<div style={{display:'flex',flexWrap:'wrap',gap:4,marginBottom:10}}>{r.facilities.slice(0,4).map(f=><span key={f} style={{fontSize:10,background:C.bg,color:C.mid,padding:'2px 8px',borderRadius:99,border:`1px solid ${C.bdr}`}}>{f}</span>)}{r.facilities.length>4&&<span style={{fontSize:10,color:C.lite}}>+{r.facilities.length-4}</span>}</div>}
            <div style={{display:'flex',gap:6}}>
              <button style={btnS('ghost','sm')} onClick={()=>setModal(r)}>✏️ Edit</button>
              <button style={{...btnS('ghost','sm'),color:C.pri}} onClick={()=>setHistoryRoom(r)}>📝 History</button>
              <button style={btnS('red','sm')} onClick={()=>setDel(r)}>🗑️</button>
            </div>
          </div>
        })}
      </div>
      {modal!==null&&<Modal title={modal.id?'Edit Kamar':'Tambah Kamar'} onClose={()=>setModal(null)} width={640}><RoomForm initial={modal.id?modal:null} props={props} onSave={async d=>{await actions.saveRoom(d);setModal(null);showToast('Kamar disimpan ✓')}} onClose={()=>setModal(null)}/></Modal>}
      {del&&<Confirm msg={`Hapus kamar ${del.number}?${tenants.find(t=>t.roomId===del.id&&t.status==='active')?' Kamar ini masih ada penyewa aktif.':''}`} onYes={async()=>{await actions.deleteRoom(del.id);setDel(null);showToast('Kamar dihapus','warn')}} onNo={()=>setDel(null)}/>}
      {bulkAddOpen&&<BulkRoomModal props={props} onClose={()=>setBulkAddOpen(false)} onSave={async newRooms=>{
        for(const r of newRooms) await actions.saveRoom(r)
        setBulkAddOpen(false)
        showToast(`✅ ${newRooms.length} kamar berhasil ditambahkan!`)
      }}/>}
      {bulkEditOpen&&<BulkEditModal rooms={rooms} props={props} onClose={()=>setBulkEditOpen(false)} onSave={async updatedRooms=>{
        for(const r of updatedRooms) await actions.saveRoom(r)
        setBulkEditOpen(false)
        showToast(`✅ Kamar berhasil diupdate!`)
      }}/>}
      {historyRoom&&(()=>{
        const roomTenants = tenants.filter(t=>t.roomId===historyRoom.id).sort((a,b)=>b.checkInDate.localeCompare(a.checkInDate))
        return (
          <Modal title={`📝 History Kamar ${historyRoom.number}`} subtitle={`${roomTenants.length} penyewa tercatat`} onClose={()=>setHistoryRoom(null)} width={520}>
            {historyRoom.notes&&<div style={{background:C.priLt,borderRadius:10,padding:'10px 14px',marginBottom:14,fontSize:13,color:C.pri}}>📌 {historyRoom.notes}</div>}
            {roomTenants.length===0&&<Empty icon="📋" title="Belum ada riwayat penyewa" sub="Kamar ini belum pernah dihuni"/>}
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {roomTenants.map(t=>{
                const duration = t.checkOutDate&&t.checkInDate ? Math.ceil((new Date(t.checkOutDate)-new Date(t.checkInDate))/2592e6) : null
                return (
                  <div key={t.id} style={{...CS.card,padding:'12px 14px',borderLeft:`4px solid ${t.status==='active'?C.grn:C.bdr}`}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                      <div>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                          <span style={{fontSize:14,fontWeight:700,color:C.txt}}>{t.name}</span>
                          <Badge s={t.status}/>
                        </div>
                        <div style={{fontSize:12,color:C.mid}}>📱 {t.phone} · 💼 {t.occupation}</div>
                        <div style={{fontSize:12,color:C.mid,marginTop:2}}>
                          📅 {t.checkInDate} → {t.checkOutDate||'sekarang'}
                          {duration&&<span style={{marginLeft:8,color:C.lite}}>({duration} bulan)</span>}
                        </div>
                        {t.notes&&<div style={{fontSize:11,color:C.mid,marginTop:4,fontStyle:'italic'}}>"{t.notes}"</div>}
                      </div>
                      <div style={{textAlign:'right',flexShrink:0}}>
                        <div style={{fontSize:13,fontWeight:700,color:C.grn}}>{fmt(t.rentAmount)}/bln</div>
                        <div style={{fontSize:11,color:C.mid}}>Deposit: {fmt(t.depositAmount)}</div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </Modal>
        )
      })()}
    </div>
  )
}

function TenantsView({ data, actions, showToast }) {
  const { props, rooms, tenants, invoices, charges } = data
  const [modal, setModal] = useState(null)
  const [del, setDel] = useState(null)
  const [waModal, setWaModal] = useState(null)
  const [kontrakModal, setKontrakModal] = useState(null)
  const [renewalModal, setRenewalModal] = useState(null)
  const [tab, setTab] = useState('active')
  const [search, setSearch] = useState('')
  const [filterProp, setFilterProp] = useState('all')
  const filtered = tenants.filter(t=>{
    if (tab==='active'&&t.status!=='active') return false
    if (tab==='checkedout'&&t.status!=='checkedout') return false
    if (filterProp!=='all'&&t.propertyId!==filterProp) return false
    if (search&&!t.name.toLowerCase().includes(search.toLowerCase())&&!t.phone.includes(search)) return false
    return true
  })
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
        <div><h1 style={{margin:0,fontSize:22,fontWeight:800}}>Penyewa</h1><p style={{margin:'4px 0 0',fontSize:13,color:C.mid}}>{tenants.filter(t=>t.status==='active').length} penyewa aktif</p></div>
        <button style={btnS('pri')} onClick={()=>setModal({})}>＋ Tambah Penyewa</button>
      </div>
      <Tabs tabs={[{id:'active',label:'Aktif',count:tenants.filter(t=>t.status==='active').length},{id:'checkedout',label:'Check-out',count:tenants.filter(t=>t.status==='checkedout').length}]} active={tab} onChange={setTab}/>
      <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:16}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} style={{...inp(),width:220,flex:'none'}} placeholder="🔍 Cari nama / no. HP..."/>
        <select value={filterProp} onChange={e=>setFilterProp(e.target.value)} style={{...inp(),width:'auto',flex:'none'}}><option value="all">Semua Properti</option>{props.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </div>
      {filtered.length===0&&<Empty icon="👥" title="Tidak ada penyewa" sub="Tambah penyewa baru"/>}
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {filtered.map(t=>{
          const room=rooms.find(r=>r.id===t.roomId), prop=props.find(p=>p.id===t.propertyId)
          const dl=dLeft(t.checkOutDate), unpaid=invoices.filter(i=>i.tenantId===t.id&&i.status!=='paid').length
          return <div key={t.id} style={{...CS.card,padding:'14px 18px'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:8}}>
              <div style={{flex:1,minWidth:200}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}>
                  <span style={{fontSize:15,fontWeight:800,color:C.txt}}>{t.name}</span>
                  <Badge s={t.status}/>
                  {unpaid>0&&<span style={{background:C.redLt,color:C.red,fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:99}}>{unpaid} belum bayar</span>}
                </div>
                <div style={{fontSize:12,color:C.mid,display:'flex',gap:12,flexWrap:'wrap'}}>
                  <span>🏠 {prop?.name||'—'} · {room?.number||'—'}</span>
                  <span>📱 {t.phone}</span>
                  <span>💼 {t.occupation}</span>
                </div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:14,fontWeight:700,color:C.grn}}>{fmt(t.rentAmount)}/{PERIOD_LBL[t.rentPeriod]||'Bln'}</div>
                <div style={{fontSize:11,color:C.mid}}>{t.checkInDate} → {t.checkOutDate}</div>
                {t.status==='active'&&<div style={{fontSize:11,fontWeight:700,color:dl<=14?C.red:dl<=30?C.amb:C.mid}}>{dl>0?`${dl} hari lagi`:'Sudah berakhir'}</div>}
                {t.depositAmount>0&&<div style={{fontSize:11,color:C.pri}}>Deposit: {fmt(t.depositAmount-t.depositReturned)}</div>}
              </div>
            </div>
            <div style={{display:'flex',gap:6,marginTop:10,flexWrap:'wrap'}}>
              <button style={btnS('ghost','sm')} onClick={()=>setModal(t)}>✏️ Edit</button>
              <button style={btnS('wa','sm')} onClick={()=>setWaModal(t)}>💬 WhatsApp</button>
              <button style={{...btnS('ghost','sm'),color:C.pri}} onClick={()=>setKontrakModal(t)}>📄 Kontrak</button>
              {t.status==='active'&&dLeft(t.checkOutDate)<=60&&<button style={{...btnS('grn','sm')}} onClick={()=>setRenewalModal(t)}>📋 Perpanjang</button>}
              <button style={btnS('red','sm')} onClick={()=>setDel(t)}>🗑️</button>
            </div>
          </div>
        })}
      </div>
      {modal!==null&&<Modal title={modal.id?'Edit Penyewa':'Tambah Penyewa'} onClose={()=>setModal(null)} width={640}><TenantForm initial={modal.id?modal:null} props={props} rooms={rooms} onSave={async d=>{await actions.saveTenant(d);setModal(null);showToast('Penyewa disimpan ✓')}} onClose={()=>setModal(null)}/></Modal>}
      {del&&<Confirm msg={`Hapus penyewa "${del.name}"?`} onYes={async()=>{await actions.deleteTenant(del.id);setDel(null);showToast('Penyewa dihapus','warn')}} onNo={()=>setDel(null)}/>}
      {waModal&&<WAModal tenant={waModal} room={rooms.find(r=>r.id===waModal.roomId)} prop={props.find(p=>p.id===waModal.propertyId)} invoices={invoices} onClose={()=>setWaModal(null)}/>}
      {renewalModal&&<RenewalModal
        tenant={renewalModal}
        room={rooms.find(r=>r.id===renewalModal.roomId)}
        prop={props.find(p=>p.id===renewalModal.propertyId)}
        onClose={()=>setRenewalModal(null)}
        onRenew={async({newEndDate,newRent,newDeposit,months})=>{
          const updated = {...renewalModal, checkOutDate:newEndDate, rentAmount:newRent, depositAmount:newDeposit}
          await actions.saveTenant(updated)
          setRenewalModal(null)
          showToast(`✅ Kontrak ${renewalModal.name} diperpanjang ${months} bulan!`)
        }}
      />}
      {kontrakModal&&<Modal title="Kontrak Sewa" subtitle={kontrakModal.name} onClose={()=>setKontrakModal(null)} width={440}>
        <div style={{textAlign:'center',padding:20}}>
          <div style={{fontSize:48,marginBottom:12}}>📄</div>
          <p style={{color:C.mid,fontSize:13,marginBottom:20}}>Cetak kontrak sewa untuk <b>{kontrakModal.name}</b> — kamar {rooms.find(r=>r.id===kontrakModal.roomId)?.number||'?'}</p>
          <button style={btnS('pri')} onClick={()=>{printKontrak(kontrakModal,rooms.find(r=>r.id===kontrakModal.roomId),props.find(p=>p.id===kontrakModal.propertyId));setKontrakModal(null)}}>🖨️ Cetak Kontrak Sewa</button>
        </div>
      </Modal>}
    </div>
  )
}

function InvoicesView({ data, actions, showToast }) {
  const { props, rooms, tenants, invoices, charges } = data
  const [modal, setModal] = useState(null)
  const [payModal, setPayModal] = useState(null)
  const [proofModal, setProofModal] = useState(null)
  const [del, setDel] = useState(null)
  const [tab, setTab] = useState('all')
  const [filterProp, setFilterProp] = useState('all')
  const [filterMonth, setFilterMonth] = useState(nowMonth())
  const [payMethod, setPayMethod] = useState(PAY_METHODS[0])
  const [payDate, setPayDate] = useState(todayStr())
  const today = todayStr()
  const filtered = invoices.filter(i=>{
    const isOverdue = i.status==='overdue'||(i.status==='unpaid'&&i.dueDate<today)
    if (tab==='paid'&&i.status!=='paid') return false
    if (tab==='unpaid'&&i.status!=='unpaid'&&!isOverdue) return false
    if (tab==='overdue'&&!isOverdue) return false
    if (filterProp!=='all'&&i.propertyId!==filterProp) return false
    if (filterMonth&&!i.month.startsWith(filterMonth)) return false
    return true
  }).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))

  async function generate() {
    const today2=todayStr(), month=nowMonth(); let count=0
    for (const t of tenants.filter(t=>t.status==='active')) {
      if (invoices.find(i=>i.tenantId===t.id&&i.month===month)) continue
      const room=rooms.find(r=>r.id===t.roomId), m=month.replace('-','')
      await actions.saveInvoice({id:uid(),invNo:`INV-${m}-${Math.floor(1000+Math.random()*9000)}`,tenantId:t.id,roomId:t.roomId,propertyId:t.propertyId,items:[{desc:`Sewa ${room?.number||''} - ${mLabel(month)}`,qty:1,unitPrice:t.rentAmount,amount:t.rentAmount}],totalAmount:t.rentAmount,month,dueDate:today2.slice(0,8)+'10',paidDate:null,status:'unpaid',paymentMethod:null,notes:'',createdAt:today2})
      count++
    }
    showToast(count>0?`${count} tagihan berhasil dibuat ✓`:'Semua tagihan bulan ini sudah ada','info')
  }

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20,flexWrap:'wrap',gap:10}}>
        <div><h1 style={{margin:0,fontSize:22,fontWeight:800}}>Tagihan</h1><p style={{margin:'4px 0 0',fontSize:13,color:C.mid}}>{invoices.length} total</p></div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <button style={btnS('teal','sm')} onClick={generate}>⚡ Generate Bulan Ini</button>
          <button style={btnS('pri')} onClick={()=>setModal({})}>＋ Buat Tagihan</button>
        </div>
      </div>
      <Tabs tabs={[{id:'all',label:'Semua',count:0},{id:'unpaid',label:'Belum Bayar',count:invoices.filter(i=>i.status==='unpaid').length},{id:'overdue',label:'Terlambat',count:invoices.filter(i=>i.status==='overdue'||(i.status==='unpaid'&&i.dueDate<today)).length},{id:'paid',label:'Lunas',count:0}]} active={tab} onChange={setTab}/>
      <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:16}}>
        <input type="month" value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} style={{...inp(),width:'auto',flex:'none'}}/>
        <select value={filterProp} onChange={e=>setFilterProp(e.target.value)} style={{...inp(),width:'auto',flex:'none'}}><option value="all">Semua Properti</option>{props.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </div>
      {filtered.length===0&&<Empty icon="🧾" title="Tidak ada tagihan" sub="Ubah filter atau buat tagihan baru"/>}
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {filtered.map(inv=>{
          const t=tenants.find(x=>x.id===inv.tenantId), r=rooms.find(x=>x.id===inv.roomId)
          const p=props.find(x=>x.id===inv.propertyId)
          const isOverdue=inv.status==='overdue'||(inv.status==='unpaid'&&inv.dueDate<today)
          return <div key={inv.id} style={{...CS.card,padding:'12px 16px',borderLeft:`4px solid ${inv.status==='paid'?C.grn:isOverdue?C.red:C.amb}`}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:8}}>
              <div>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3}}>
                  <span style={{fontSize:12,fontWeight:700,color:C.mid,fontFamily:'monospace'}}>{inv.invNo}</span>
                  <Badge s={isOverdue&&inv.status!=='paid'?'overdue':inv.status}/>
                </div>
                <div style={{fontSize:14,fontWeight:700,color:C.txt}}>{t?.name||'—'} · {r?.number||'—'} · {mLabel(inv.month)}</div>
                <div style={{fontSize:11,color:C.mid}}>JT: {inv.dueDate}{inv.paidDate?` · Bayar: ${inv.paidDate}`:''}{inv.paymentMethod?` · ${inv.paymentMethod}`:''}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:16,fontWeight:800,color:C.txt}}>{fmt(inv.totalAmount)}</div>
                <div style={{display:'flex',gap:4,marginTop:6,flexWrap:'wrap',justifyContent:'flex-end'}}>
                  {inv.status!=='paid'&&<button style={btnS('grn','sm')} onClick={()=>{setPayModal(inv);setPayMethod(PAY_METHODS[0]);setPayDate(todayStr())}}>✓ Bayar</button>}
                  {inv.status!=='paid'&&<button style={{...btnS('pri','sm'),background:'linear-gradient(135deg,#7c3aed,#6d28d9)'}} onClick={()=>setProofModal({inv,t,r,p})}>📸 Bukti</button>}
                  <button style={btnS('ghost','sm')} onClick={()=>printInvoice(inv,t,r,p)}>🖨️</button>
                  {t&&inv.status==='paid'&&<button style={btnS('wa','sm')} onClick={()=>sendReceiptWA(inv,t,r,p)}>🧾 WA</button>}
                  {t&&inv.status!=='paid'&&<a href={waUrl(t.phone,`Halo ${t?.name}, tagihan ${mLabel(inv.month)} sebesar ${fmt(inv.totalAmount)} jatuh tempo ${inv.dueDate}. Bayar ke ${p?.bankName||''} ${p?.bankAccount||''}. Terima kasih 🙏`)} target="_blank" rel="noreferrer"><button style={btnS('wa','sm')}>💬</button></a>}
                  <button style={btnS('ghost','sm')} onClick={()=>setModal(inv)}>✏️</button>
                  <button style={btnS('red','sm')} onClick={()=>setDel(inv)}>🗑️</button>
                </div>
              </div>
            </div>
          </div>
        })}
      </div>
      {modal!==null&&<Modal title={modal.id?'Edit Tagihan':'Buat Tagihan'} onClose={()=>setModal(null)} width={640}><InvoiceForm initial={modal.id?modal:null} props={props} rooms={rooms} tenants={tenants} charges={charges} onSave={async d=>{await actions.saveInvoice(d);setModal(null);showToast('Tagihan disimpan ✓')}} onClose={()=>setModal(null)}/></Modal>}
      {del&&<Confirm msg={`Hapus tagihan ${del.invNo}?`} onYes={async()=>{await actions.deleteInvoice(del.id);setDel(null);showToast('Tagihan dihapus','warn')}} onNo={()=>setDel(null)}/>}
      {payModal&&<Modal title="Konfirmasi Pembayaran" subtitle={payModal.invNo} onClose={()=>setPayModal(null)} width={400}>
        <div style={{fontSize:22,fontWeight:800,color:C.grn,textAlign:'center',marginBottom:16}}>{fmt(payModal.totalAmount)}</div>
        <div style={{marginBottom:14}}><Fld label="Metode Pembayaran"><select value={payMethod} onChange={e=>setPayMethod(e.target.value)} style={inp()}>{PAY_METHODS.map(m=><option key={m} value={m}>{m}</option>)}</select></Fld></div>
        <div style={{marginBottom:20}}><Fld label="Tanggal Bayar"><input type="date" value={payDate} onChange={e=>setPayDate(e.target.value)} style={inp()}/></Fld></div>
        <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
          <button style={btnS('ghost')} onClick={()=>setPayModal(null)}>Batal</button>
          <button style={btnS('grn')} onClick={async()=>{await actions.payInvoice(payModal.id,payMethod,payDate);setPayModal(null);showToast('Pembayaran berhasil dicatat ✓')}}>✓ Konfirmasi Lunas</button>
        </div>
      </Modal>}
      {proofModal&&<ProofModal
        inv={proofModal.inv}
        tenant={proofModal.t}
        room={proofModal.r}
        prop={proofModal.p}
        allInvoices={invoices}
        tenants={tenants}
        rooms={rooms}
        settings={data.settings}
        onConfirm={async(result)=>{
          // 1. Tandai invoice yang dipilih (bisa berbeda dari yang diklik)
          const targetInvId = result.invoiceId || proofModal.inv.id
          await actions.payInvoice(targetInvId, result.paymentMethod, result.payDate)

          // 2. Upload bukti ke Google Drive (background, tidak blokir)
          let driveLink = null
          if (result.proofImage && data.settings?.gsheetUrl) {
            const bank = result.proofExtracted?.bank || (result.paymentMethod||'').replace('Transfer ','')
            const { folderPath, filename } = buildDrivePath(
              result.payDate, proofModal.t?.name,
              result.proofExtracted?.amount || proofModal.inv.totalAmount,
              proofModal.p?.name, bank
            )
            driveLink = await uploadToDrive(
              data.settings.gsheetUrl,
              { base64Image: result.proofImage.replace('data:image/jpeg;base64,',''),
                filename, folderPath,
                secret: data.settings.scriptSecret||'' }
            )
          }

          // 3. Simpan invoice — TIDAK simpan base64 di DB (hemat storage)
          // Bukti tersimpan di Google Drive, link disimpan di invoice
          const targetInv = invoices.find(i=>i.id===targetInvId) || proofModal.inv
          const updatedInv = {
            ...targetInv,
            status:'paid',
            paymentMethod: result.paymentMethod,
            paidDate: result.payDate,
            proofExtracted: result.proofExtracted ? {
              amount: result.proofExtracted.amount,
              date: result.proofExtracted.date,
              bank: result.proofExtracted.bank,
              sender: result.proofExtracted.sender,
              ref: result.proofExtracted.ref,
            } : null,
            driveLink,
            hasProof: !!result.proofImage
          }
          await actions.saveInvoice(updatedInv)
          setProofModal(null)
          showToast(driveLink
            ? '✅ Dikonfirmasi & bukti tersimpan di Google Drive!'
            : '✅ Pembayaran dikonfirmasi!')
        }}
        onClose={()=>setProofModal(null)}
      />}
    </div>
  )
}

function ExpensesView({ data, actions, showToast }) {
  const { props, expenses } = data
  const [modal, setModal]   = useState(null)
  const [del, setDel]       = useState(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [filterProp, setFilterProp] = useState('all')
  const [filterMonth, setFilterMonth] = useState(nowMonth())
  const [filterStatus, setFilterStatus] = useState('all')
  const filtered = expenses.filter(e=>{
    if (filterProp!=='all'&&e.propertyId!==filterProp) return false
    if (filterMonth&&!e.date.startsWith(filterMonth)) return false
    if (filterStatus!=='all'&&e.status!==filterStatus) return false
    return true
  }).sort((a,b)=>b.date.localeCompare(a.date))
  const total=filtered.reduce((s,e)=>s+e.amount,0), unpaidTotal=filtered.filter(e=>e.status==='unpaid').reduce((s,e)=>s+e.amount,0)
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
        <div><h1 style={{margin:0,fontSize:22,fontWeight:800}}>Pengeluaran</h1><p style={{margin:'4px 0 0',fontSize:13,color:C.mid}}>Total: {fmt(total)} · Belum bayar: {fmt(unpaidTotal)}</p></div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <button style={{...btnS('teal','sm'),background:'linear-gradient(135deg,#7c3aed,#6d28d9)'}} onClick={()=>setScanOpen(true)}>🧾 Scan Nota AI</button>
          <button style={btnS('pri')} onClick={()=>setModal({})}>＋ Tambah Manual</button>
        </div>
      </div>
      <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:16}}>
        <input type="month" value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} style={{...inp(),width:'auto',flex:'none'}}/>
        <select value={filterProp} onChange={e=>setFilterProp(e.target.value)} style={{...inp(),width:'auto',flex:'none'}}><option value="all">Semua Properti</option>{props.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{...inp(),width:'auto',flex:'none'}}><option value="all">Semua Status</option><option value="unpaid">Belum Bayar</option><option value="paid">Lunas</option></select>
      </div>
      {filtered.length===0&&<Empty icon="💸" title="Tidak ada pengeluaran"/>}
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {filtered.map(e=>{
          const prop=props.find(p=>p.id===e.propertyId)
          return <div key={e.id} style={{...CS.card,padding:'12px 16px',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
            <div>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:2}}>
                <span style={{fontSize:13,fontWeight:700,color:C.txt}}>{e.description}</span>
                {e.isRecurring&&<span style={{fontSize:10,background:C.priLt,color:C.pri,padding:'1px 6px',borderRadius:99,fontWeight:600}}>Rutin</span>}
                <Badge s={e.status}/>
              </div>
              <div style={{fontSize:11,color:C.mid}}>{e.category} · {prop?.name||'—'} · {e.date}</div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontSize:15,fontWeight:800,color:C.red}}>{fmt(e.amount)}</span>
              {e.status==='unpaid'&&<button style={btnS('grn','sm')} onClick={async()=>{await actions.saveExpense({...e,status:'paid'});showToast('Pengeluaran ditandai lunas ✓')}}>✓ Bayar</button>}
              <button style={btnS('ghost','sm')} onClick={()=>setModal(e)}>✏️</button>
              <button style={btnS('red','sm')} onClick={()=>setDel(e)}>🗑️</button>
            </div>
          </div>
        })}
      </div>
      {modal!==null&&<Modal title={modal.id?'Edit Pengeluaran':'Tambah Pengeluaran'} onClose={()=>setModal(null)} width={540}><ExpenseForm initial={modal.id?modal:null} props={props} onSave={async d=>{await actions.saveExpense(d);setModal(null);showToast('Pengeluaran disimpan ✓')}} onClose={()=>setModal(null)}/></Modal>}
      {del&&<Confirm msg={`Hapus "${del.description}"?`} onYes={async()=>{await actions.deleteExpense(del.id);setDel(null);showToast('Pengeluaran dihapus','warn')}} onNo={()=>setDel(null)}/>}
      {scanOpen&&<ReceiptScanModal
        props={props}
        settings={data.settings}
        onClose={()=>setScanOpen(false)}
        onSave={async expense=>{await actions.saveExpense(expense);showToast('✅ Pengeluaran dari nota berhasil disimpan!')}}
      />}
    </div>
  )
}

function MaintenanceView({ data, actions, showToast }) {
  const { props, rooms, tenants, maint } = data
  const [modal, setModal] = useState(null)
  const [del, setDel] = useState(null)
  const [tab, setTab] = useState('active')
  const [filterProp, setFilterProp] = useState('all')
  const prioColor = { high:C.red, medium:C.amb, low:C.grn }
  const filtered = maint.filter(m=>{
    if (tab==='active'&&!['pending','inprogress'].includes(m.status)) return false
    if (tab==='done'&&m.status!=='done') return false
    if (filterProp!=='all'&&m.propertyId!==filterProp) return false
    return true
  }).sort((a,b)=>({high:0,medium:1,low:2}[a.priority]||1)-({high:0,medium:1,low:2}[b.priority]||1)||b.reportedDate.localeCompare(a.reportedDate))
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
        <div><h1 style={{margin:0,fontSize:22,fontWeight:800}}>🔧 Maintenance</h1><p style={{margin:'4px 0 0',fontSize:13,color:C.mid}}>{maint.filter(m=>m.status!=='done').length} aktif</p></div>
        <button style={btnS('pri')} onClick={()=>setModal({})}>＋ Laporkan</button>
      </div>
      <Tabs tabs={[{id:'active',label:'Aktif',count:maint.filter(m=>['pending','inprogress'].includes(m.status)).length},{id:'done',label:'Selesai',count:maint.filter(m=>m.status==='done').length}]} active={tab} onChange={setTab}/>
      <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:16}}>
        <select value={filterProp} onChange={e=>setFilterProp(e.target.value)} style={{...inp(),width:'auto',flex:'none'}}><option value="all">Semua Properti</option>{props.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </div>
      {filtered.length===0&&<Empty icon="✅" title={tab==='active'?'Tidak ada maintenance aktif':'Belum ada yang selesai'}/>}
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {filtered.map(m=>{
          const prop=props.find(p=>p.id===m.propertyId), room=rooms.find(r=>r.id===m.roomId)
          return <div key={m.id} style={{...CS.card,padding:'14px 16px',borderLeft:`4px solid ${prioColor[m.priority]||C.mid}`}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:8}}>
              <div style={{flex:1,minWidth:200}}>
                <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4,flexWrap:'wrap'}}>
                  <span style={{fontSize:14,fontWeight:800,color:C.txt}}>{m.title}</span>
                  <Badge s={m.status}/>
                  <Badge s={m.priority}/>
                </div>
                <div style={{fontSize:12,color:C.mid,marginBottom:4}}>📍 {prop?.name||'—'}{room?` · ${room.number}`:''}</div>
                {m.description&&<div style={{fontSize:12,color:C.mid,marginBottom:4}}>{m.description}</div>}
                {m.vendor&&<div style={{fontSize:12,color:C.mid,display:'flex',gap:8,alignItems:'center'}}>🔨 {m.vendor}
                  {m.vendorPhone&&<a href={waUrl(m.vendorPhone,`Halo, konfirmasi progress pekerjaan: ${m.title} di ${prop?.name||''}. Mohon update statusnya. Terima kasih.`)} target="_blank" rel="noreferrer"><button style={btnS('wa','sm')}>💬 WA Vendor</button></a>}
                </div>}
              </div>
              <div style={{textAlign:'right',minWidth:140}}>
                <div style={{fontSize:12,color:C.mid}}>Lapor: {m.reportedDate}</div>
                {m.estimateCost>0&&<div style={{fontSize:12,color:C.mid}}>Est: {fmt(m.estimateCost)}</div>}
                {m.actualCost>0&&<div style={{fontSize:13,fontWeight:700,color:C.red}}>Aktual: {fmt(m.actualCost)}</div>}
                {m.resolvedDate&&<div style={{fontSize:12,color:C.grn}}>✅ {m.resolvedDate}</div>}
                <div style={{display:'flex',gap:4,marginTop:8,flexWrap:'wrap',justifyContent:'flex-end'}}>
                  {m.status==='pending'&&<button style={btnS('teal','sm')} onClick={async()=>{await actions.saveMaint({...m,status:'inprogress'});showToast('Status diupdate')}}>▶ Kerjakan</button>}
                  {m.status==='inprogress'&&<button style={btnS('grn','sm')} onClick={async()=>{await actions.saveMaint({...m,status:'done',resolvedDate:todayStr()});showToast('Selesai ✓')}}>✓ Selesai</button>}
                  <button style={btnS('ghost','sm')} onClick={()=>setModal(m)}>✏️</button>
                  <button style={btnS('red','sm')} onClick={()=>setDel(m)}>🗑️</button>
                </div>
              </div>
            </div>
          </div>
        })}
      </div>
      {modal!==null&&<Modal title={modal.id?'Edit Maintenance':'Laporkan Kerusakan'} onClose={()=>setModal(null)} width={620}><MaintenanceForm initial={modal.id?modal:null} props={props} rooms={rooms} tenants={tenants} onSave={async d=>{await actions.saveMaint(d);setModal(null);showToast('Maintenance disimpan ✓')}} onClose={()=>setModal(null)}/></Modal>}
      {del&&<Confirm msg={`Hapus laporan "${del.title}"?`} onYes={async()=>{await actions.deleteMaint(del.id);setDel(null);showToast('Dihapus','warn')}} onNo={()=>setDel(null)}/>}
    </div>
  )
}

function MetersView({ data, actions, showToast }) {
  const { props, rooms, tenants, meters } = data
  const [modal, setModal] = useState(null)
  const [del, setDel] = useState(null)
  const [filterProp, setFilterProp] = useState('all')
  const [filterMonth, setFilterMonth] = useState(nowMonth())
  const filtered = meters.filter(m=>{
    if (filterProp!=='all'&&m.propertyId!==filterProp) return false
    if (filterMonth&&m.month!==filterMonth) return false
    return true
  })
  const totalKwh=filtered.reduce((s,m)=>s+m.kwUsed,0), totalBill=filtered.reduce((s,m)=>s+m.totalAmount,0)
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
        <div><h1 style={{margin:0,fontSize:22,fontWeight:800}}>⚡ Meteran Listrik</h1><p style={{margin:'4px 0 0',fontSize:13,color:C.mid}}>{mLabel(filterMonth)}: {totalKwh} kWh · {fmt(totalBill)}</p></div>
        <button style={btnS('pri')} onClick={()=>setModal({})}>＋ Catat Meteran</button>
      </div>
      <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:16}}>
        <input type="month" value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} style={{...inp(),width:'auto',flex:'none'}}/>
        <select value={filterProp} onChange={e=>setFilterProp(e.target.value)} style={{...inp(),width:'auto',flex:'none'}}><option value="all">Semua Properti</option>{props.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </div>
      {filtered.length===0&&<Empty icon="⚡" title="Belum ada catatan meteran" sub="Catat stand meter tiap kamar per bulan"/>}
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {filtered.map(m=>{
          const room=rooms.find(r=>r.id===m.roomId), tenant=tenants.find(t=>t.id===m.tenantId), prop=props.find(p=>p.id===m.propertyId)
          return <div key={m.id} style={{...CS.card,padding:'12px 16px',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:C.txt}}>{room?.number||'—'} · {tenant?.name||'—'}</div>
              <div style={{fontSize:11,color:C.mid}}>{prop?.name||'—'} · {mLabel(m.month)}</div>
              <div style={{fontSize:12,color:C.mid,marginTop:2}}>{m.kwStart} → {m.kwEnd} kWh = <b>{m.kwUsed} kWh</b> × {fmt(m.tariff)}/kWh</div>
              {m.billed&&<span style={{fontSize:10,background:C.grnLt,color:C.grn,padding:'1px 8px',borderRadius:99,fontWeight:600,marginTop:4,display:'inline-block'}}>Sudah Ditagih</span>}
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div style={{fontSize:16,fontWeight:800,color:C.amb}}>{fmt(m.totalAmount)}</div>
              <button style={btnS('ghost','sm')} onClick={()=>setModal(m)}>✏️</button>
              <button style={btnS('red','sm')} onClick={()=>setDel(m)}>🗑️</button>
            </div>
          </div>
        })}
      </div>
      {modal!==null&&<Modal title={modal.id?'Edit Meteran':'Catat Meteran'} onClose={()=>setModal(null)} width={500}><MeterForm initial={modal.id?modal:null} props={props} rooms={rooms} tenants={tenants} onSave={async d=>{await actions.saveMeter(d);setModal(null);showToast('Meteran disimpan ✓')}} onClose={()=>setModal(null)}/></Modal>}
      {del&&<Confirm msg="Hapus catatan meteran ini?" onYes={async()=>{await actions.deleteMeter(del.id);setDel(null);showToast('Dihapus','warn')}} onNo={()=>setDel(null)}/>}
    </div>
  )
}

function ReportsView({ data }) {
  const { props, rooms, tenants, invoices, expenses, maint } = data
  const [tab, setTab] = useState('cashflow')
  const [month, setMonth] = useState(nowMonth())
  const [propFilter, setPropFilter] = useState('all')
  const invF = propFilter==='all'?invoices:invoices.filter(i=>i.propertyId===propFilter)
  const expF = propFilter==='all'?expenses:expenses.filter(e=>e.propertyId===propFilter)
  const months = Array.from({length:6},(_,i)=>{ const d=new Date();d.setMonth(d.getMonth()-(5-i));return d.toISOString().slice(0,7) })
  const pnl = months.map(m=>({
    label:mLabel(m),
    rev:invF.filter(i=>i.month===m&&i.status==='paid').reduce((s,i)=>s+i.totalAmount,0),
    exp:expF.filter(e=>e.date.startsWith(m)).reduce((s,e)=>s+e.amount,0),
    maint:maint.filter(x=>x.resolvedDate?.startsWith(m)).reduce((s,x)=>s+x.actualCost,0)
  })).map(r=>({...r,profit:r.rev-r.exp-r.maint}))
  const thisRev=invF.filter(i=>i.month===month&&i.status==='paid').reduce((s,i)=>s+i.totalAmount,0)
  const thisExp=expF.filter(e=>e.date.startsWith(month)).reduce((s,e)=>s+e.amount,0)
  const thisMaint=maint.filter(x=>x.resolvedDate?.startsWith(month)).reduce((s,x)=>s+x.actualCost,0)
  const expByCat=expF.filter(e=>e.date.startsWith(month)).reduce((acc,e)=>{acc[e.category]=(acc[e.category]||0)+e.amount;return acc},{})
  function exportCSV(){
    const rows=[['Bulan','Pendapatan','Pengeluaran','Maintenance','Laba Bersih'],...pnl.map(r=>[r.label,r.rev,r.exp,r.maint,r.profit])]
    const csv=rows.map(r=>r.map(csvEsc).join(',')).join('\n')
    const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,\uFEFF'+encodeURIComponent(csv);a.download=`laporan-${month}.csv`;a.click()
  }
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20,flexWrap:'wrap',gap:10}}>
        <h1 style={{margin:0,fontSize:22,fontWeight:800}}>📊 Laporan Keuangan</h1>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <input type="month" value={month} onChange={e=>setMonth(e.target.value)} style={{...inp(),width:'auto',flex:'none'}}/>
          <select value={propFilter} onChange={e=>setPropFilter(e.target.value)} style={{...inp(),width:'auto',flex:'none'}}><option value="all">Semua Properti</option>{props.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <button style={btnS('ghost','sm')} onClick={exportCSV}>📥 Export CSV</button>
          <button style={btnS('teal','sm')} onClick={()=>exportLaporanPDF(data,month,propFilter)}>📄 Export PDF</button>
          <button style={btnS('ghost','sm')} onClick={()=>window.print()}>🖨️ Print</button>
        </div>
      </div>
      <Tabs tabs={[{id:'cashflow',label:'Arus Kas',count:0},{id:'pnl',label:'Laba/Rugi',count:0},{id:'roi',label:'ROI',count:0},{id:'tenant',label:'Per Penyewa',count:0}]} active={tab} onChange={setTab}/>
      {tab==='cashflow'&&<div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:12,marginBottom:20}}>
          <StatCard icon="💰" label="Pendapatan" value={short(thisRev)} accent={C.grn}/>
          <StatCard icon="💸" label="Pengeluaran" value={short(thisExp)} accent={C.red}/>
          <StatCard icon="🔧" label="Biaya Maint." value={short(thisMaint)} accent={C.amb}/>
          <StatCard icon="📈" label="Laba Bersih" value={short(thisRev-thisExp-thisMaint)} accent={thisRev-thisExp-thisMaint>=0?C.grn:C.red}/>
        </div>
        <div style={{...CS.card,padding:20,marginBottom:16}}>
          <div style={{fontWeight:700,fontSize:14,marginBottom:16}}>6 Bulan Terakhir</div>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13,minWidth:500}}>
              <thead><tr>{['Bulan','Pendapatan','Pengeluaran','Maintenance','Laba Bersih'].map(h=><th key={h} style={{textAlign:'left',padding:'8px 10px',borderBottom:`2px solid ${C.bdr}`,color:C.mid,fontWeight:700,fontSize:11,textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
              <tbody>{pnl.map((r,i)=><tr key={i} style={{background:i%2?C.bg:'#fff'}}>
                <td style={{padding:'8px 10px',fontWeight:600}}>{r.label}</td>
                <td style={{padding:'8px 10px',color:C.grn,fontWeight:600}}>{fmt(r.rev)}</td>
                <td style={{padding:'8px 10px',color:C.red}}>{fmt(r.exp)}</td>
                <td style={{padding:'8px 10px',color:C.amb}}>{fmt(r.maint)}</td>
                <td style={{padding:'8px 10px',fontWeight:700,color:r.profit>=0?C.grn:C.red}}>{fmt(r.profit)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </div>
        <div style={{...CS.card,padding:20}}>
          <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>Pengeluaran Per Kategori — {mLabel(month)}</div>
          {Object.keys(expByCat).length===0&&<Empty icon="✅" title="Tidak ada pengeluaran bulan ini"/>}
          {Object.entries(expByCat).sort((a,b)=>b[1]-a[1]).map(([cat,amt])=><div key={cat} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:`1px solid ${C.bdr}`}}><span style={{fontSize:13}}>{cat}</span><span style={{fontSize:13,fontWeight:700,color:C.red}}>{fmt(amt)}</span></div>)}
        </div>
      </div>}
      {tab==='pnl'&&<div style={{...CS.card,padding:20}}>
        <div style={{fontWeight:800,fontSize:16,marginBottom:16}}>Laba/Rugi — {mLabel(month)}</div>
        {[{label:'Pendapatan Sewa',v:thisRev,c:C.grn},{label:'Pengeluaran Operasional',v:-thisExp,c:C.red},{label:'Biaya Maintenance',v:-thisMaint,c:C.amb}].map((r,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:`1px solid ${C.bdr}`}}><span style={{fontSize:13}}>{r.label}</span><span style={{fontSize:13,fontWeight:600,color:r.c}}>{fmt(Math.abs(r.v))}{r.v<0?' (-)':''}</span></div>)}
        <div style={{display:'flex',justifyContent:'space-between',padding:'12px 0',borderTop:`2px solid ${C.bdr}`,marginTop:4}}><span style={{fontSize:15,fontWeight:800}}>LABA BERSIH</span><span style={{fontSize:15,fontWeight:800,color:thisRev-thisExp-thisMaint>=0?C.grn:C.red}}>{fmt(thisRev-thisExp-thisMaint)}</span></div>
      </div>}
      {tab==='roi'&&<div style={{...CS.card,padding:20}}>
        <div style={{fontWeight:700,fontSize:14,marginBottom:16}}>ROI Per Properti (Kumulatif)</div>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:13,minWidth:600}}>
            <thead><tr>{['Properti','Kamar','Hunian','Total Pendapatan','Total Pengeluaran','Laba'].map(h=><th key={h} style={{textAlign:'left',padding:'8px 10px',borderBottom:`2px solid ${C.bdr}`,color:C.mid,fontWeight:700,fontSize:11,textTransform:'uppercase',whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>
            <tbody>{props.map((p,i)=>{
              const pRooms=rooms.filter(r=>r.propertyId===p.id), occ=pRooms.filter(r=>r.status==='occupied').length
              const rev=invoices.filter(i=>i.propertyId===p.id&&i.status==='paid').reduce((s,i)=>s+i.totalAmount,0)
              const exp=expenses.filter(e=>e.propertyId===p.id).reduce((s,e)=>s+e.amount,0)
              return <tr key={p.id} style={{background:i%2?C.bg:'#fff'}}>
                <td style={{padding:'8px 10px'}}><div style={{display:'flex',alignItems:'center',gap:6}}><div style={{width:10,height:10,borderRadius:99,background:p.color||C.pri}}/>{p.name}</div></td>
                <td style={{padding:'8px 10px'}}>{pRooms.length}</td>
                <td style={{padding:'8px 10px'}}>{pRooms.length?Math.round(occ/pRooms.length*100):0}%</td>
                <td style={{padding:'8px 10px',color:C.grn,fontWeight:600}}>{fmt(rev)}</td>
                <td style={{padding:'8px 10px',color:C.red}}>{fmt(exp)}</td>
                <td style={{padding:'8px 10px',fontWeight:700,color:rev-exp>=0?C.grn:C.red}}>{fmt(rev-exp)}</td>
              </tr>
            })}</tbody>
          </table>
        </div>
      </div>}
      {tab==='tenant'&&<div style={{...CS.card,padding:20}}>
        <div style={{fontWeight:700,fontSize:14,marginBottom:16}}>Riwayat Per Penyewa</div>
        {tenants.filter(t=>propFilter==='all'||t.propertyId===propFilter).map(t=>{
          const tInv=invoices.filter(i=>i.tenantId===t.id), room=rooms.find(r=>r.id===t.roomId)
          const paid=tInv.filter(i=>i.status==='paid').reduce((s,i)=>s+i.totalAmount,0)
          const outstanding=tInv.filter(i=>i.status!=='paid').reduce((s,i)=>s+i.totalAmount,0)
          return <div key={t.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:`1px solid ${C.bdr}`}}>
            <div><div style={{fontSize:13,fontWeight:700}}>{t.name} · {room?.number||'?'}</div><div style={{fontSize:11,color:C.mid}}>{tInv.length} tagihan · CI: {t.checkInDate}</div></div>
            <div style={{textAlign:'right'}}><div style={{fontSize:13,fontWeight:700,color:C.grn}}>Lunas: {fmt(paid)}</div>{outstanding>0&&<div style={{fontSize:12,color:C.red}}>Belum: {fmt(outstanding)}</div>}<div style={{fontSize:11,color:C.pri}}>Deposit: {fmt(t.depositAmount)}</div></div>
          </div>
        })}
      </div>}
    </div>
  )
}

function SettingsView({ data, actions, user, showToast }) {
  const { settings, props } = data
  const [tab, setTab] = useState('wa')
  const [cfg, setCfg] = useState({...DEFAULT_SETTINGS,...settings})
  const [syncing, setSyncing] = useState(false)

  async function saveCfg() { await actions.saveKey('settings', cfg); showToast('Pengaturan disimpan ✓') }
  async function testFonnte() {
    if (!cfg.fonnteToken||!cfg.testPhone) { showToast('Isi Fonnte Token dan No. HP Test dulu','error'); return }
    const ok = await sendFonnte(cfg.fonnteToken, cfg.testPhone, 'Test pesan dari KosManager Pro ✓ Koneksi Fonnte berhasil!')
    showToast(ok?'Test WA terkirim ✓':'Gagal - cek token Fonnte',ok?'success':'error')
  }

  const gscript = `// KosManager Pro — Apps Script v3
// CARA SETUP:
// 1. Buka Google Sheets baru → Extensions → Apps Script
// 2. Paste kode ini → ganti SECRET di bawah sesuai isian di app
// 3. Deploy → New deployment → Web App
//    Execute as: Me | Who has access: Anyone
// 4. Copy URL → paste di Pengaturan → Google Sheets

var SECRET = "${cfg.scriptSecret||'isi-secret-token-anda'}";

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);

    if (payload.secret !== SECRET) {
      return respond({ ok: false, error: "Unauthorized" });
    }

    // UPLOAD BUKTI TRANSFER KE GOOGLE DRIVE
    if (payload.action === "uploadFile") {
      var folder = getOrCreateFolder(payload.folderPath);
      var imageBlob = Utilities.newBlob(
        Utilities.base64Decode(payload.base64),
        payload.mimeType || "image/jpeg",
        payload.filename
      );
      var file = folder.createFile(imageBlob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      var fileUrl = "https://drive.google.com/file/d/" + file.getId() + "/view";
      return respond({ ok: true, fileId: file.getId(), url: fileUrl });
    }

    // SYNC DATA KE SPREADSHEET
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(payload.sheet) || ss.insertSheet(payload.sheet);
    if (sheet.getLastRow() === 0 && payload.headers) {
      sheet.appendRow(payload.headers);
      sheet.getRange(1,1,1,payload.headers.length).setFontWeight("bold").setBackground("#4f46e5").setFontColor("#ffffff");
    }
    if (payload.clearFirst && sheet.getLastRow() > 1) {
      sheet.deleteRows(2, sheet.getLastRow() - 1);
    }
    if (payload.rows && payload.rows.length > 0) {
      payload.rows.forEach(function(row) { sheet.appendRow(row); });
    }
    return respond({ ok: true, rows: payload.rows ? payload.rows.length : 0 });

  } catch (error) {
    return respond({ ok: false, error: error.toString() });
  }
}

function getOrCreateFolder(folderPath) {
  var parts = folderPath.split("/").filter(function(p) { return p.length > 0; });
  var current = DriveApp.getRootFolder();
  parts.forEach(function(name) {
    var found = current.getFoldersByName(name);
    current = found.hasNext() ? found.next() : current.createFolder(name);
  });
  return current;
}

function respond(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return respond({ status: "ready", app: "KosManager Pro v3", time: new Date().toString() });
}`

  async function syncSheets() {
    if (!cfg.gsheetUrl) { showToast('Masukkan URL Apps Script dulu','error'); return }
    setSyncing(true)
    const url = cfg.gsheetUrl
    const { tenants, rooms, invoices, expenses } = data
    try {
      const post = (payload) => fetch(url,{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      await post({sheet:'Penyewa',headers:['Nama','Kamar','Properti','Status','Check-in','Check-out','Sewa/Bln','Telepon'],clearFirst:true,rows:tenants.map(t=>{const r=rooms.find(x=>x.id===t.roomId),p=props.find(x=>x.id===t.propertyId);return[t.name,r?.number||'',p?.name||'',t.status,t.checkInDate,t.checkOutDate,t.rentAmount,t.phone]})})
      await new Promise(r=>setTimeout(r,600))
      await post({sheet:'Tagihan',headers:['No Invoice','Bulan','Total','Status','Tgl Bayar','Metode'],clearFirst:true,rows:invoices.map(i=>[i.invNo,i.month,i.totalAmount,i.status,i.paidDate||'',i.paymentMethod||''])})
      await new Promise(r=>setTimeout(r,600))
      const months=Array.from({length:6},(_,i)=>{const d=new Date();d.setMonth(d.getMonth()-(5-i));return d.toISOString().slice(0,7)})
      await post({sheet:'Arus Kas',headers:['Bulan','Pendapatan','Pengeluaran','Laba Bersih'],clearFirst:true,rows:months.map(m=>{const rev=invoices.filter(i=>i.month===m&&i.status==='paid').reduce((s,i)=>s+i.totalAmount,0);const exp=expenses.filter(e=>e.date.startsWith(m)).reduce((s,e)=>s+e.amount,0);return[mLabel(m),rev,exp,rev-exp]})})
      showToast('Sync ke Google Sheets berhasil ✓ (cek spreadsheet Anda)')
    } catch(e) { showToast('Gagal sync: '+e.message,'error') }
    setSyncing(false)
  }

  return (
    <div>
      <div style={{marginBottom:20}}><h1 style={{margin:0,fontSize:22,fontWeight:800}}>⚙️ Pengaturan</h1><p style={{margin:'4px 0 0',fontSize:13,color:C.mid}}>Integrasi WA, Google Sheets, dan konfigurasi</p></div>
      <Tabs tabs={[{id:'wa',label:'📱 WA Otomatis',count:0},{id:'gsheets',label:'📊 Google Sheets',count:0},{id:'vision',label:'🤖 AI Bukti Transfer',count:0},{id:'account',label:'👤 Akun',count:0}]} active={tab} onChange={setTab}/>

      {tab==='wa'&&<div>
        <div style={{...CS.card,padding:20,marginBottom:16}}>
          <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>📱 Konfigurasi Fonnte</div>
          <p style={{fontSize:13,color:C.mid,marginBottom:16,lineHeight:1.7}}>
            <a href="https://fonnte.com" target="_blank" rel="noreferrer" style={{color:C.pri,fontWeight:700}}>Fonnte.com</a> — WA API Indonesia ~Rp50rb/bulan. Daftar, scan QR, copy token.
          </p>
          <FGrid>
            <Fld label="Fonnte API Token"><input type="password" value={cfg.fonnteToken||''} onChange={e=>setCfg(p=>({...p,fonnteToken:e.target.value}))} style={inp()} placeholder="xxxx"/></Fld>
            <Inp label="No. HP Test" value={cfg.testPhone||''} onChange={e=>setCfg(p=>({...p,testPhone:e.target.value}))} placeholder="08123456789"/>
          </FGrid>
          <div style={{display:'flex',gap:8,marginTop:10,marginBottom:16}}>
            <button style={btnS('pri')} onClick={saveCfg}>💾 Simpan</button>
            <button style={btnS('wa')} onClick={testFonnte}>💬 Test Kirim WA</button>
          </div>
          <div style={{background:C.grnLt,borderRadius:10,padding:'12px 16px',fontSize:12,color:C.txt,lineHeight:1.8}}>
            <b>Cara daftar Fonnte:</b> 1. <a href="https://fonnte.com/register" target="_blank" rel="noreferrer" style={{color:C.pri}}>fonnte.com/register</a> · 2. Daftar · 3. Tambah perangkat & scan QR · 4. Copy token
          </div>
        </div>

        <div style={{...CS.card,padding:20,marginBottom:16}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <div>
              <div style={{fontWeight:700,fontSize:15}}>🔔 Reminder Otomatis Terjadwal</div>
              <div style={{fontSize:12,color:C.mid,marginTop:2}}>Kirim WA reminder tagihan jatuh tempo secara otomatis setiap hari</div>
            </div>
            <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
              <div style={{position:'relative',width:44,height:24}}>
                <input type="checkbox" checked={!!cfg.reminderEnabled} onChange={e=>setCfg(p=>({...p,reminderEnabled:e.target.checked}))} style={{opacity:0,width:0,height:0}}/>
                <div style={{position:'absolute',inset:0,background:cfg.reminderEnabled?C.grn:'#cbd5e1',borderRadius:99,transition:'background 0.2s',cursor:'pointer'}} onClick={()=>setCfg(p=>({...p,reminderEnabled:!p.reminderEnabled}))}>
                  <div style={{position:'absolute',top:2,left:cfg.reminderEnabled?22:2,width:20,height:20,background:'#fff',borderRadius:99,transition:'left 0.2s',boxShadow:'0 1px 4px rgba(0,0,0,0.2)'}}/>
                </div>
              </div>
              <span style={{fontSize:12,fontWeight:600,color:cfg.reminderEnabled?C.grn:C.mid}}>{cfg.reminderEnabled?'Aktif':'Nonaktif'}</span>
            </label>
          </div>
          {cfg.reminderEnabled&&(
            <div>
              <FGrid>
                <Inp label="Kirim Reminder Jam Berapa" type="number" value={cfg.reminderHour||8} onChange={e=>setCfg(p=>({...p,reminderHour:Number(e.target.value)}))} min={6} max={21} placeholder="8"/>
                <div style={{display:'flex',alignItems:'flex-end'}}><button style={btnS('pri')} onClick={saveCfg}>💾 Simpan</button></div>
              </FGrid>
              <div style={{background:C.priLt,borderRadius:10,padding:'10px 14px',fontSize:12,color:C.pri}}>
                ℹ️ Reminder berjalan <b>selama tab app ini terbuka</b> di browser. Buka app setiap pagi dan biarkan tab tetap aktif. Akan kirim WA ke semua penyewa yang tagihannya jatuh tempo / terlambat pada pukul <b>{cfg.reminderHour||8}:00</b> setiap hari.
              </div>
            </div>
          )}
        </div>
      </div>}

      {tab==='gsheets'&&<div>
        <div style={{...CS.card,padding:20,marginBottom:16}}>
          <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>📊 Sync ke Google Sheets + Upload Drive</div>
          <p style={{fontSize:13,color:C.mid,marginBottom:16,lineHeight:1.7}}>Satu Apps Script untuk: sync data ke Spreadsheet + upload bukti transfer ke Google Drive.</p>
          <div style={{background:C.ambLt,borderRadius:10,padding:'12px 16px',marginBottom:16,fontSize:12,lineHeight:2}}>
            <b>📋 Setup (sekali saja):</b><br/>
            <b>1.</b> Buka Google Sheets baru → <b>Extensions → Apps Script</b><br/>
            <b>2.</b> Paste kode di bawah → <b>Deploy → New Deployment → Web App</b><br/>
            <b style={{color:C.red}}>   Execute as: Me | Who has access: Anyone</b><br/>
            <b>3.</b> Copy URL → paste di bawah → isi Secret Token → Simpan
          </div>
          <FGrid>
            <Fld label="Apps Script Web App URL">
              <input value={cfg.gsheetUrl||''} onChange={e=>setCfg(p=>({...p,gsheetUrl:e.target.value}))} style={inp()} placeholder="https://script.google.com/macros/s/xxx/exec"/>
            </Fld>
            <Inp label="🔐 Secret Token (isi bebas, wajib sama dengan di script)" value={cfg.scriptSecret||''} onChange={e=>setCfg(p=>({...p,scriptSecret:e.target.value}))} placeholder="rahasia123"/>
          </FGrid>
          <div style={{display:'flex',gap:8,marginBottom:16}}>
            <button style={btnS('pri')} onClick={saveCfg}>💾 Simpan</button>
            <button style={btnS(cfg.gsheetUrl?'grn':'ghost')} onClick={syncSheets} disabled={!cfg.gsheetUrl||syncing}>{syncing?'⏳ Menyinkronkan...':'📊 Sync Sekarang'}</button>
          </div>
          <details><summary style={{fontSize:12,fontWeight:700,color:C.pri,cursor:'pointer',userSelect:'none'}}>📄 Lihat Kode Apps Script (dengan secret token)</summary>
            <pre style={{background:'#1e293b',color:'#e2e8f0',padding:16,borderRadius:10,fontSize:11,overflow:'auto',marginTop:10,lineHeight:1.6,whiteSpace:'pre-wrap'}}>{gscript}</pre>
          </details>
        </div>
      </div>}

      {tab==='vision'&&<div>
        <div style={{...CS.card,padding:20,marginBottom:16}}>
          <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>🤖 AI Verifikasi Bukti Transfer</div>
          <p style={{fontSize:13,color:C.mid,marginBottom:16,lineHeight:1.7}}>
            Upload screenshot bukti transfer → AI baca otomatis → ekstrak jumlah, tanggal, bank → konfirmasi 1 klik. Menggunakan <b>Google Vision API</b> (1.000 gambar gratis/bulan).
          </p>

          <div style={{background:C.ambLt,borderRadius:10,padding:'12px 16px',marginBottom:16,fontSize:12,lineHeight:2}}>
            <b>📋 Cara dapat API Key (gratis):</b><br/>
            <b>1.</b> Buka <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" style={{color:C.pri}}>console.cloud.google.com</a> → Login Google<br/>
            <b>2.</b> Buat project baru → klik <b>Enable APIs</b> → cari <b>"Cloud Vision API"</b> → Enable<br/>
            <b>3.</b> Klik <b>Credentials</b> → <b>Create Credentials</b> → <b>API Key</b><br/>
            <b>4.</b> Copy API Key → paste di bawah<br/>
            <b style={{color:C.red}}>5.</b> <b>Restrict API key</b> ke Vision API saja (keamanan)
          </div>

          <Fld label="Google Vision API Key">
            <input type="password" value={cfg.visionKey||''} onChange={e=>setCfg(p=>({...p,visionKey:e.target.value}))}
              style={{...inp(),marginBottom:8}} placeholder="AIzaSy..."/>
          </Fld>
          <div style={{marginBottom:14}}>
            <label style={{fontSize:11,fontWeight:700,color:C.mid,display:'block',marginBottom:5,textTransform:'uppercase'}}>Claude API Key (Opsional — untuk analisis lebih akurat)</label>
            <input type="password" value={cfg.claudeKey||''} onChange={e=>setCfg(p=>({...p,claudeKey:e.target.value}))} style={inp()} placeholder="sk-ant-..."/>
            <div style={{fontSize:10,color:C.lite,marginTop:4}}>Dapatkan di <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" style={{color:C.pri}}>console.anthropic.com</a>. Digunakan untuk analisis nota yang lebih cerdas.</div>
          </div>
          <div style={{display:'flex',gap:8,marginBottom:16}}>
            <button style={btnS('pri')} onClick={saveCfg}>💾 Simpan API Key</button>
            <button style={btnS('ghost')} onClick={async()=>{
              if (!cfg.visionKey) { showToast('Isi API Key dulu','error'); return }
              // Test dengan gambar putih 1x1 pixel
              try {
                const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${cfg.visionKey}`,{
                  method:'POST', headers:{'Content-Type':'application/json'},
                  body:JSON.stringify({requests:[{image:{content:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='},features:[{type:'TEXT_DETECTION'}]}]})
                })
                if (res.ok) showToast('API Key valid ✓','success')
                else { const e=await res.json(); showToast('API Key tidak valid: '+e.error?.message,'error') }
              } catch(e) { showToast('Gagal test: '+e.message,'error') }
            }}>🔗 Test API Key</button>
          </div>

          <div style={{...CS.card,padding:16,background:C.ambLt,marginBottom:12}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <div style={{fontWeight:700,fontSize:13,color:C.amb}}>🚨 Deteksi Anomali Otomatis</div>
              <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
                <div style={{position:'relative',width:40,height:22}}>
                  <input type="checkbox" checked={!!cfg.anomalyEnabled} onChange={e=>setCfg(p=>({...p,anomalyEnabled:e.target.checked}))} style={{opacity:0,width:0,height:0}}/>
                  <div style={{position:'absolute',inset:0,background:cfg.anomalyEnabled?C.grn:'#cbd5e1',borderRadius:99,cursor:'pointer'}} onClick={()=>setCfg(p=>({...p,anomalyEnabled:!p.anomalyEnabled}))}>
                    <div style={{position:'absolute',top:2,left:cfg.anomalyEnabled?20:2,width:18,height:18,background:'#fff',borderRadius:99,transition:'left 0.2s',boxShadow:'0 1px 3px rgba(0,0,0,0.2)'}}/>
                  </div>
                </div>
                <span style={{fontSize:12,fontWeight:600,color:cfg.anomalyEnabled?C.grn:C.mid}}>{cfg.anomalyEnabled?'Aktif':'Nonaktif'}</span>
              </label>
            </div>
            <div style={{fontSize:12,color:C.mid}}>Deteksi lonjakan tagihan listrik, pemakaian tidak wajar, dan tagihan menunggak lama. Muncul di tab Anomali di Laporan Pagi.</div>
          </div>
          <div style={{...CS.card,padding:16,background:C.priLt}}>
            <div style={{fontWeight:700,fontSize:13,color:C.pri,marginBottom:8}}>📸 Cara Pakai di App</div>
            <div style={{fontSize:12,color:C.txt,lineHeight:1.9}}>
              1. Minta penyewa kirim screenshot bukti transfer via WA<br/>
              2. Di menu <b>Tagihan</b> → cari invoice yang belum bayar<br/>
              3. Klik tombol <b>📸 Bukti</b> → upload screenshot<br/>
              4. AI otomatis baca jumlah, tanggal, bank<br/>
              5. Cek hasilnya → klik <b>✅ Konfirmasi Lunas</b>
            </div>
          </div>
        </div>
      </div>}

      {tab==='account'&&<div>
        <div style={{...CS.card,padding:20,marginBottom:16}}>
          <div style={{fontWeight:700,fontSize:15,marginBottom:12}}>👤 Info Akun</div>
          <div style={{background:C.bg,borderRadius:10,padding:'12px 16px',fontSize:13,marginBottom:16}}>
            <div style={{display:'flex',gap:12,alignItems:'center'}}>
              <div style={{width:48,height:48,borderRadius:99,background:C.pri,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,color:'#fff',fontWeight:800}}>{user?.email?.[0]?.toUpperCase()||'U'}</div>
              <div><div style={{fontWeight:700,color:C.txt}}>{user?.email||'—'}</div><div style={{fontSize:11,color:C.mid}}>Supabase User ID: {user?.id?.slice(0,8)||'—'}...</div></div>
            </div>
          </div>
          <div style={{background:C.priLt,borderRadius:10,padding:'12px 16px',fontSize:12,color:C.pri,lineHeight:1.8}}>
            <b>Multi-staf dengan Supabase:</b> Setiap staf perlu akun Supabase sendiri. Buat akun di <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer" style={{color:C.pri,fontWeight:700}}>Supabase Dashboard</a> → Authentication → Users → Invite User. Jalankan SETUP.sql untuk setup RLS profile.
          </div>
        </div>
      </div>}
    </div>
  )
}

function BackupView({ data, actions, showToast }) {
  const fileRef = useRef()
  const [syncing, setSyncing] = useState(false)

  function doExport() {
    const blob = new Blob([JSON.stringify({...data,exportedAt:new Date().toISOString(),version:'3.0'},null,2)],{type:'application/json'})
    const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`kosmanager-backup-${todayStr()}.json`; a.click()
    showToast('Backup berhasil diunduh ✓')
  }

  function doImport(e) {
    const file = e.target.files[0]; if(!file) return
    const reader = new FileReader()
    reader.onload = async ev => {
      try {
        const parsed = JSON.parse(ev.target.result)
        if (!parsed.props||!parsed.rooms||!parsed.tenants) throw new Error('Format tidak valid')
        await actions.restoreAll(parsed)
        showToast('Data berhasil direstore ✓')
      } catch(err) { showToast('Gagal restore: '+err.message,'error') }
    }
    reader.readAsText(file)
  }

  const tables = [
    {key:'tenants',label:'Penyewa',cols:['name','phone','email','occupation','checkInDate','checkOutDate','rentAmount','status']},
    {key:'invoices',label:'Tagihan',cols:['invNo','month','totalAmount','status','paidDate','paymentMethod']},
    {key:'expenses',label:'Pengeluaran',cols:['category','description','amount','date','status']},
    {key:'maint',label:'Maintenance',cols:['title','category','status','priority','reportedDate','resolvedDate','actualCost']},
    {key:'meters',label:'Meteran',cols:['month','kwStart','kwEnd','kwUsed','tariff','totalAmount']}
  ]

  return (
    <div>
      <div style={{marginBottom:20}}><h1 style={{margin:0,fontSize:22,fontWeight:800}}>💾 Backup & Data</h1></div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:16,marginBottom:20}}>
        <div style={{...CS.card,padding:24,textAlign:'center'}}><div style={{fontSize:40,marginBottom:10}}>📦</div><div style={{fontWeight:700,fontSize:15,marginBottom:6}}>Export Backup</div><p style={{fontSize:12,color:C.mid,marginBottom:16}}>Unduh semua data sebagai JSON.</p><button style={btnS('pri')} onClick={doExport}>📥 Download JSON</button></div>
        <div style={{...CS.card,padding:24,textAlign:'center'}}><div style={{fontSize:40,marginBottom:10}}>📂</div><div style={{fontWeight:700,fontSize:15,marginBottom:6}}>Import / Restore</div><p style={{fontSize:12,color:C.mid,marginBottom:16}}>Restore dari file backup. <b>Data lama ditimpa.</b></p><input ref={fileRef} type="file" accept=".json" onChange={doImport} style={{display:'none'}}/><button style={btnS('teal')} onClick={()=>fileRef.current.click()}>📤 Pilih File</button></div>
        <div style={{...CS.card,padding:24,textAlign:'center'}}><div style={{fontSize:40,marginBottom:10}}>📊</div><div style={{fontWeight:700,fontSize:15,marginBottom:6}}>Sync Google Sheets</div><p style={{fontSize:12,color:C.mid,marginBottom:16}}>{data.settings?.gsheetUrl?'URL tersimpan ✓':'Setup di Pengaturan → Google Sheets dulu.'}</p><button style={btnS(data.settings?.gsheetUrl?'grn':'ghost')} onClick={syncSheets} disabled={!data.settings?.gsheetUrl||syncing}>{syncing?'⏳ Syncing...':'📊 Sync Sekarang'}</button></div>
      </div>
      <div style={{...CS.card,padding:20,marginBottom:16}}>
        <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>📊 Ringkasan Data</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(120px,1fr))',gap:10}}>
          {[['🏠','Properti',data.props.length],['🚪','Kamar',data.rooms.length],['👥','Penyewa',data.tenants.length],['🧾','Tagihan',data.invoices.length],['💸','Pengeluaran',data.expenses.length],['🔧','Maintenance',data.maint.length],['⚡','Meteran',data.meters.length]].map(([icon,label,count])=>(
            <div key={label} style={{background:C.bg,borderRadius:10,padding:'12px',textAlign:'center'}}><div style={{fontSize:22}}>{icon}</div><div style={{fontSize:20,fontWeight:800,color:C.txt}}>{count}</div><div style={{fontSize:11,color:C.mid}}>{label}</div></div>
          ))}
        </div>
      </div>
      <div style={{...CS.card,padding:20}}>
        <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>📥 Export CSV Per Data</div>
        <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
          {tables.map(t=><button key={t.key} style={btnS('ghost','sm')} onClick={()=>{
            const rows=[t.cols,...(data[t.key]||[]).map(r=>t.cols.map(c=>r[c]??''))]
            const csv=rows.map(r=>r.map(csvEsc).join(',')).join('\n')
            const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,\uFEFF'+encodeURIComponent(csv);a.download=`${t.key}-${todayStr()}.csv`;a.click()
            showToast(`Export ${t.label} berhasil ✓`)
          }}>📥 {t.label}</button>)}
        </div>
      </div>
    </div>
  )
}



// ─── PDF LAPORAN (Print-ready HTML → PDF via browser) ────────────────────────
function exportLaporanPDF(data, month, propFilter) {
  const { props, rooms, tenants, invoices, expenses, maint } = data
  const invF = propFilter==='all' ? invoices : invoices.filter(i=>i.propertyId===propFilter)
  const expF = propFilter==='all' ? expenses : expenses.filter(e=>e.propertyId===propFilter)
  const propName = propFilter==='all' ? 'Semua Properti' : props.find(p=>p.id===propFilter)?.name||''

  // Build 6-month data
  const months = Array.from({length:6},(_,i)=>{
    const d=new Date(month+'-01'); d.setMonth(d.getMonth()-(5-i))
    return d.toISOString().slice(0,7)
  })
  const fmtRp = n => 'Rp '+Number(n||0).toLocaleString('id-ID')
  const getLbl = m => { if(!m)return''; const [y,mo]=m.split('-'); return ['','Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'][+mo]+' '+y }

  const pnl = months.map(m=>({
    label: getLbl(m), m,
    rev:  invF.filter(i=>i.month===m&&i.status==='paid').reduce((s,i)=>s+i.totalAmount,0),
    exp:  expF.filter(e=>e.date.startsWith(m)).reduce((s,e)=>s+e.amount,0),
    maint:maint.filter(x=>x.resolvedDate?.startsWith(m)).reduce((s,x)=>s+x.actualCost,0)
  })).map(r=>({...r, profit:r.rev-r.exp-r.maint}))

  // This month details
  const thisRev  = invF.filter(i=>i.month===month&&i.status==='paid').reduce((s,i)=>s+i.totalAmount,0)
  const thisExp  = expF.filter(e=>e.date.startsWith(month)).reduce((s,e)=>s+e.amount,0)
  const paidInv  = invF.filter(i=>i.month===month&&i.status==='paid')
  const unpaidInv= invF.filter(i=>i.month===month&&i.status!=='paid')

  const tenantRows = paidInv.map(inv=>{
    const t=tenants.find(x=>x.id===inv.tenantId), r=rooms.find(x=>x.id===inv.roomId)
    return `<tr><td>${t?.name||'—'}</td><td>${r?.number||'—'}</td><td style="text-align:right">${fmtRp(inv.totalAmount)}</td><td>${inv.paidDate||'—'}</td><td>${inv.paymentMethod||'—'}</td></tr>`
  }).join('')

  const unpaidRows = unpaidInv.map(inv=>{
    const t=tenants.find(x=>x.id===inv.tenantId), r=rooms.find(x=>x.id===inv.roomId)
    return `<tr style="color:#dc2626"><td>${t?.name||'—'}</td><td>${r?.number||'—'}</td><td style="text-align:right">${fmtRp(inv.totalAmount)}</td><td>${inv.dueDate||'—'}</td><td>BELUM BAYAR</td></tr>`
  }).join('')

  const expRows = expF.filter(e=>e.date.startsWith(month)).map(e=>
    `<tr><td>${e.category}</td><td>${e.description}</td><td style="text-align:right;color:#dc2626">${fmtRp(e.amount)}</td><td>${e.date}</td><td>${e.status==='paid'?'Lunas':'Belum Bayar'}</td></tr>`
  ).join('')

  const trendRows = pnl.map(r=>
    `<tr><td><b>${r.label}</b></td><td style="color:#16a34a">${fmtRp(r.rev)}</td><td style="color:#dc2626">${fmtRp(r.exp)}</td><td style="color:#d97706">${fmtRp(r.maint)}</td><td style="font-weight:700;color:${r.profit>=0?'#16a34a':'#dc2626'}">${fmtRp(r.profit)}</td></tr>`
  ).join('')

  const occupied = rooms.filter(r=>r.status==='occupied').length
  const occ = rooms.length>0?Math.round(occupied/rooms.length*100):0

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Laporan KosManager — ${getLbl(month)}</title>
<style>
  @page { margin: 20mm 15mm; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #111; margin: 0; }
  h1 { font-size: 20px; margin: 0 0 4px; color: #1e3a8a; }
  h2 { font-size: 14px; color: #1e3a8a; margin: 20px 0 8px; border-bottom: 2px solid #e2e8f0; padding-bottom: 4px; }
  h3 { font-size: 12px; color: #475569; margin: 12px 0 6px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid #4f46e5; }
  .kpi { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; margin-bottom: 16px; }
  .kpi-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; }
  .kpi-val { font-size: 18px; font-weight: 800; }
  .kpi-lbl { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 11px; }
  th { background: #f1f5f9; padding: 7px 8px; text-align: left; font-weight: 700; color: #475569; border-bottom: 1px solid #e2e8f0; }
  td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; }
  .summary-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f1f5f9; }
  .footer { margin-top: 20px; text-align: center; font-size: 10px; color: #94a3b8; }
  @media print { body{padding:0} button{display:none} }
</style></head><body>
<div class="header">
  <div>
    <h1>📊 Laporan Keuangan</h1>
    <div style="font-size:13px;color:#475569">${getLbl(month)} · ${propName}</div>
    <div style="font-size:11px;color:#94a3b8">Dicetak: ${new Date().toLocaleDateString('id-ID',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</div>
  </div>
  <div style="text-align:right">
    <div style="font-size:11px;color:#64748b">KosManager Pro</div>
    <div style="font-size:10px;color:#94a3b8">Sistem Manajemen Properti</div>
  </div>
</div>

<div class="kpi">
  <div class="kpi-box"><div class="kpi-val" style="color:#16a34a">${fmtRp(thisRev)}</div><div class="kpi-lbl">Pendapatan</div></div>
  <div class="kpi-box"><div class="kpi-val" style="color:#dc2626">${fmtRp(thisExp)}</div><div class="kpi-lbl">Pengeluaran</div></div>
  <div class="kpi-box"><div class="kpi-val" style="color:${thisRev-thisExp>=0?'#16a34a':'#dc2626'}">${fmtRp(thisRev-thisExp)}</div><div class="kpi-lbl">Laba Bersih</div></div>
  <div class="kpi-box"><div class="kpi-val" style="color:#4f46e5">${occ}%</div><div class="kpi-lbl">Tingkat Hunian</div></div>
</div>

${paidInv.length>0?`
<h2>✅ Pembayaran Diterima (${paidInv.length} invoice)</h2>
<table><thead><tr><th>Penyewa</th><th>Kamar</th><th>Jumlah</th><th>Tgl Bayar</th><th>Metode</th></tr></thead>
<tbody>${tenantRows}</tbody>
<tfoot><tr><td colspan="2"><b>TOTAL</b></td><td style="text-align:right;font-weight:700;color:#16a34a">${fmtRp(thisRev)}</td><td colspan="2"></td></tr></tfoot>
</table>`:''}

${unpaidInv.length>0?`
<h2>⚠️ Belum Dibayar (${unpaidInv.length} invoice)</h2>
<table><thead><tr><th>Penyewa</th><th>Kamar</th><th>Jumlah</th><th>Jatuh Tempo</th><th>Status</th></tr></thead>
<tbody>${unpaidRows}</tbody></table>`:''}

${expRows?`
<h2>💸 Pengeluaran</h2>
<table><thead><tr><th>Kategori</th><th>Keterangan</th><th>Jumlah</th><th>Tanggal</th><th>Status</th></tr></thead>
<tbody>${expRows}</tbody>
<tfoot><tr><td colspan="2"><b>TOTAL</b></td><td style="text-align:right;font-weight:700;color:#dc2626">${fmtRp(thisExp)}</td><td colspan="2"></td></tr></tfoot>
</table>`:''}

<h2>📈 Tren 6 Bulan</h2>
<table><thead><tr><th>Bulan</th><th>Pendapatan</th><th>Pengeluaran</th><th>Maintenance</th><th>Laba Bersih</th></tr></thead>
<tbody>${trendRows}</tbody></table>

<div class="footer">KosManager Pro — Laporan ini dibuat otomatis oleh sistem · ${new Date().toLocaleDateString('id-ID')}</div>
<script>window.onload=function(){window.print()}<\/script>
</body></html>`

  const w = window.open('','_blank','width=900,height=1100')
  if (w) { w.document.write(html); w.document.close() }
}


// ─── WA REMINDER SCHEDULER ───────────────────────────────────────────────────
// Pakai browser setInterval — aktif selama tab dibuka
// Untuk production tanpa server, ini solusi paling mudah tanpa biaya

function useReminderScheduler(data, showToast) {
  const settings = data?.settings || {}
  const lastRunRef = useRef({})

  useEffect(() => {
    if (!settings.reminderEnabled || !settings.fonnteToken) return

    const check = async () => {
      const now = new Date()
      const todayKey = now.toISOString().split('T')[0]
      const hour = now.getHours()

      // Only run once per day at configured hour
      if (lastRunRef.current[todayKey]) return
      if (hour < (settings.reminderHour || 8)) return

      lastRunRef.current[todayKey] = true

      const today = todayKey
      const overdueInvs = (data.invoices||[]).filter(i =>
        (i.status==='unpaid' || i.status==='overdue') && i.dueDate <= today
      )

      if (overdueInvs.length === 0) return

      let sent = 0
      for (const inv of overdueInvs.slice(0, 20)) {
        const tenant = (data.tenants||[]).find(t=>t.id===inv.tenantId)
        const prop   = (data.props||[]).find(p=>p.id===inv.propertyId)
        if (!tenant?.phone) continue

        const dayLate = Math.ceil((new Date(today)-new Date(inv.dueDate))/864e5)
        const msg = dayLate===0
          ? `Halo *${tenant.name}*, tagihan sewa ${inv.invNo} sebesar *${fmt(inv.totalAmount)}* jatuh tempo HARI INI (${inv.dueDate}). Mohon segera bayarkan ke ${prop?.bankName||''} ${prop?.bankAccount||''}. Terima kasih 🙏`
          : `Halo *${tenant.name}*, tagihan sewa ${inv.invNo} sebesar *${fmt(inv.totalAmount)}* sudah *${dayLate} hari terlambat* (jatuh tempo ${inv.dueDate}). Mohon segera bayarkan ke ${prop?.bankName||''} ${prop?.bankAccount||''}. Terima kasih 🙏`

        const ok = await sendFonnte(settings.fonnteToken, tenant.phone, msg)
        if (ok) sent++
        await new Promise(r=>setTimeout(r,2000)) // 2s delay between messages
      }

      if (sent > 0) showToast(`🔔 ${sent} reminder WA otomatis terkirim`, 'info')
    }

    // Check every 5 minutes
    check()
    const interval = setInterval(check, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [settings.reminderEnabled, settings.fonnteToken, settings.reminderHour, data.invoices])
}

// ─── KALENDER VIEW ────────────────────────────────────────────────────────────
function CalendarView({ data }) {
  const { props, rooms, tenants, invoices } = data
  const [filterProp, setFilterProp] = useState('all')
  const [viewMode, setViewMode] = useState('hunian') // hunian | pendapatan

  // Generate 6 months
  const months = Array.from({length:6}, (_,i)=>{
    const d = new Date(); d.setMonth(d.getMonth()-(5-i))
    return d.toISOString().slice(0,7)
  })

  const filteredRooms = filterProp==='all' ? rooms : rooms.filter(r=>r.propertyId===filterProp)

  // For each room+month, find occupant
  function getOccupant(roomId, month) {
    return tenants.find(t =>
      t.roomId===roomId &&
      t.checkInDate<=month+'-28' &&
      (t.checkOutDate>=month+'-01' || !t.checkOutDate)
    )
  }

  function getRevenue(roomId, month) {
    return invoices.filter(i=>i.roomId===roomId&&i.month===month&&i.status==='paid')
      .reduce((s,i)=>s+i.totalAmount,0)
  }

  // Summary per month
  const monthSummary = months.map(m=>({
    month:m,
    label:mLabel(m),
    occupied: filteredRooms.filter(r=>getOccupant(r.id,m)).length,
    total: filteredRooms.length,
    revenue: filteredRooms.reduce((s,r)=>s+getRevenue(r.id,m),0)
  }))

  const STATUS_COLORS = {
    active: C.grn,
    checkedout: C.mid,
  }

  return (
    <div>
      <div style={{marginBottom:20}}>
        <h1 style={{margin:0,fontSize:22,fontWeight:800}}>📅 Kalender Hunian</h1>
        <p style={{margin:'4px 0 0',fontSize:13,color:C.mid}}>Riwayat dan status kamar per bulan</p>
      </div>

      {/* Controls */}
      <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:16}}>
        <select value={filterProp} onChange={e=>setFilterProp(e.target.value)} style={{...inp(),width:'auto',flex:'none'}}>
          <option value="all">Semua Properti</option>
          {props.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div style={{display:'flex',gap:4,background:C.bg,borderRadius:8,padding:4}}>
          {[['hunian','👥 Hunian'],['pendapatan','💰 Pendapatan']].map(([id,label])=>(
            <button key={id} onClick={()=>setViewMode(id)}
              style={{...btnS(viewMode===id?'pri':'ghost','sm'),borderRadius:6}}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Monthly Summary Bar */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:8,marginBottom:20}}>
        {monthSummary.map((ms,i)=>{
          const pct = ms.total>0 ? Math.round(ms.occupied/ms.total*100) : 0
          return (
            <div key={i} style={{...CS.card,padding:'12px 10px',textAlign:'center'}}>
              <div style={{fontSize:11,fontWeight:700,color:C.mid,marginBottom:6}}>{ms.label}</div>
              {viewMode==='hunian' ? <>
                <div style={{height:6,background:C.bg,borderRadius:99,marginBottom:6,overflow:'hidden'}}>
                  <div style={{height:'100%',width:pct+'%',background:pct>=80?C.grn:pct>=50?C.amb:C.red,borderRadius:99,transition:'width 0.4s'}}/>
                </div>
                <div style={{fontSize:13,fontWeight:800,color:pct>=80?C.grn:pct>=50?C.amb:C.red}}>{pct}%</div>
                <div style={{fontSize:10,color:C.lite}}>{ms.occupied}/{ms.total} kamar</div>
              </> : <>
                <div style={{fontSize:13,fontWeight:800,color:C.grn}}>{short(ms.revenue)}</div>
                <div style={{fontSize:10,color:C.lite}}>pendapatan</div>
              </>}
            </div>
          )
        })}
      </div>

      {/* Grid Kalender */}
      {filteredRooms.length===0&&<Empty icon="🚪" title="Tidak ada kamar" sub="Pilih properti atau tambah kamar dulu"/>}
      {filteredRooms.length>0&&(
        <div style={{...CS.card,overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',minWidth:600}}>
            <thead>
              <tr>
                <th style={{padding:'10px 14px',textAlign:'left',borderBottom:`2px solid ${C.bdr}`,fontSize:12,fontWeight:700,color:C.mid,whiteSpace:'nowrap',background:'#fafafa',position:'sticky',left:0,zIndex:1}}>Kamar</th>
                {months.map(m=>(
                  <th key={m} style={{padding:'10px 12px',textAlign:'center',borderBottom:`2px solid ${C.bdr}`,fontSize:11,fontWeight:700,color:m===nowMonth()?C.pri:C.mid,background:m===nowMonth()?C.priLt:'#fafafa',minWidth:90,whiteSpace:'nowrap'}}>
                    {mLabel(m)}{m===nowMonth()&&' ●'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRooms.map((r,ri)=>{
                const prop = props.find(p=>p.id===r.propertyId)
                return (
                  <tr key={r.id} style={{background:ri%2?'#fafafa':'#fff'}}>
                    <td style={{padding:'8px 14px',borderBottom:`1px solid ${C.bdr}`,fontWeight:600,fontSize:13,whiteSpace:'nowrap',position:'sticky',left:0,background:ri%2?'#fafafa':'#fff',zIndex:1}}>
                      <div style={{color:C.txt}}>{r.number}</div>
                      <div style={{fontSize:10,color:C.lite}}>{prop?.name}</div>
                    </td>
                    {months.map(m=>{
                      const occupant = getOccupant(r.id, m)
                      const rev = getRevenue(r.id, m)
                      const isCurrent = m===nowMonth()
                      return (
                        <td key={m} style={{padding:'6px 8px',borderBottom:`1px solid ${C.bdr}`,textAlign:'center',background:isCurrent?(occupant?'#f0fdf4':C.priLt+88):'inherit'}}>
                          {occupant ? (
                            <div style={{background:occupant.status==='active'?C.grnLt:C.bg,borderRadius:6,padding:'4px 6px'}}>
                              <div style={{fontSize:11,fontWeight:600,color:occupant.status==='active'?C.grn:C.mid,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:80}}>
                                {occupant.name.split(' ')[0]}
                              </div>
                              {viewMode==='pendapatan'&&rev>0&&<div style={{fontSize:10,color:C.grn}}>{short(rev)}</div>}
                            </div>
                          ) : (
                            <span style={{fontSize:10,color:C.lite}}>—</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div style={{display:'flex',gap:16,marginTop:12,flexWrap:'wrap'}}>
        {[[C.grnLt+'  border: 1px solid '+C.grn,C.grn,'Terisi / Aktif'],['#fafafa','#94a3b8','Kosong'],[C.priLt+'88','#4f46e5','Bulan Ini']].map(([bg,co,label],i)=>(
          <div key={i} style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:C.mid}}>
            <div style={{width:14,height:14,borderRadius:4,background:bg,border:`1px solid ${co}33`}}/>
            {label}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── ANALITIK VIEW (Grafik detail) ─────────────────────────────────────────────
function AnalyticsView({ data }) {
  const { props, rooms, tenants, invoices, expenses } = data
  const [filterProp, setFilterProp] = useState('all')

  const months12 = Array.from({length:12}, (_,i)=>{
    const d = new Date(); d.setMonth(d.getMonth()-(11-i))
    return d.toISOString().slice(0,7)
  })
  const months6 = months12.slice(6)

  const invF = filterProp==='all' ? invoices : invoices.filter(i=>i.propertyId===filterProp)
  const expF = filterProp==='all' ? expenses : expenses.filter(e=>e.propertyId===filterProp)
  const roomsF = filterProp==='all' ? rooms : rooms.filter(r=>r.propertyId===filterProp)

  const chartData = months12.map(m=>{
    const rev = invF.filter(i=>i.month===m&&i.status==='paid').reduce((s,i)=>s+i.totalAmount,0)
    const exp = expF.filter(e=>e.date.startsWith(m)).reduce((s,e)=>s+e.amount,0)
    // Occupancy: count unique rooms with active tenant that month
    const occupiedRooms = roomsF.filter(r=>
      tenants.some(t=>t.roomId===r.id&&t.checkInDate<=m+'-28'&&(t.checkOutDate>=m+'-01'||!t.checkOutDate))
    ).length
    const occ = roomsF.length>0 ? Math.round(occupiedRooms/roomsF.length*100) : 0
    return { label:mLabel(m), m, rev, exp, profit:rev-exp, occ, paid:invF.filter(i=>i.month===m&&i.status==='paid').length, unpaid:invF.filter(i=>i.month===m&&i.status!=='paid').length }
  })

  const maxRev = Math.max(...chartData.map(d=>d.rev), 1)
  const maxExp = Math.max(...chartData.map(d=>Math.max(d.rev,d.exp)), 1)

  // Stats
  const totalRev = chartData.reduce((s,d)=>s+d.rev,0)
  const totalExp = chartData.reduce((s,d)=>s+d.exp,0)
  const avgOcc = Math.round(chartData.reduce((s,d)=>s+d.occ,0)/12)
  const bestMonth = [...chartData].sort((a,b)=>b.rev-a.rev)[0]

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20,flexWrap:'wrap',gap:10}}>
        <div><h1 style={{margin:0,fontSize:22,fontWeight:800}}>📊 Analitik Detail</h1><p style={{margin:'4px 0 0',fontSize:13,color:C.mid}}>Tren 12 bulan terakhir</p></div>
        <select value={filterProp} onChange={e=>setFilterProp(e.target.value)} style={{...inp(),width:'auto',flex:'none'}}>
          <option value="all">Semua Properti</option>
          {props.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* KPI Cards */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:12,marginBottom:20}}>
        <StatCard icon="💰" label="Total Pendapatan (12 bln)" value={short(totalRev)} accent={C.grn}/>
        <StatCard icon="💸" label="Total Pengeluaran (12 bln)" value={short(totalExp)} accent={C.red}/>
        <StatCard icon="📈" label="Laba Bersih (12 bln)" value={short(totalRev-totalExp)} accent={totalRev>totalExp?C.grn:C.red}/>
        <StatCard icon="🏠" label="Rata-rata Hunian" value={avgOcc+'%'} sub="12 bulan" accent={C.pri}/>
        <StatCard icon="🏆" label="Bulan Terbaik" value={bestMonth?.label||'—'} sub={short(bestMonth?.rev||0)} accent="#7c3aed"/>
      </div>

      {/* Revenue + Expense Chart - 12 bulan */}
      <div style={{...CS.card,padding:20,marginBottom:16}}>
        <div style={{fontWeight:700,fontSize:14,color:C.txt,marginBottom:16}}>💰 Pendapatan vs Pengeluaran — 12 Bulan</div>
        <div style={{display:'flex',alignItems:'flex-end',gap:4,height:160,paddingBottom:20,position:'relative'}}>
          {/* Y-axis lines */}
          {[0.25,0.5,0.75,1].map(pct=>(
            <div key={pct} style={{position:'absolute',left:0,right:0,bottom:pct*140+20,borderTop:'1px dashed #e2e8f0',zIndex:0}}>
              <span style={{fontSize:9,color:C.lite,marginLeft:2}}>{short(maxExp*pct)}</span>
            </div>
          ))}
          {chartData.map((d,i)=>(
            <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2,zIndex:1}}>
              <div style={{width:'100%',display:'flex',gap:1,alignItems:'flex-end',height:140}}>
                <div title={`Rev: ${fmt(d.rev)}`} style={{flex:1,background:`${C.pri}cc`,borderRadius:'3px 3px 0 0',height:maxExp>0?`${d.rev/maxExp*100}%`:'1px',minHeight:1,transition:'height 0.4s',cursor:'default'}}/>
                <div title={`Exp: ${fmt(d.exp)}`} style={{flex:1,background:`${C.red}88`,borderRadius:'3px 3px 0 0',height:maxExp>0?`${d.exp/maxExp*100}%`:'1px',minHeight:1,transition:'height 0.4s',cursor:'default'}}/>
              </div>
              <div style={{fontSize:8,color:C.lite,whiteSpace:'nowrap',textAlign:'center',transform:'rotate(-45deg)',transformOrigin:'center',marginTop:4}}>{d.label}</div>
            </div>
          ))}
        </div>
        <div style={{display:'flex',gap:16,marginTop:8}}>
          <div style={{display:'flex',alignItems:'center',gap:4,fontSize:11,color:C.mid}}><div style={{width:10,height:10,background:`${C.pri}cc`,borderRadius:2}}/> Pendapatan</div>
          <div style={{display:'flex',alignItems:'center',gap:4,fontSize:11,color:C.mid}}><div style={{width:10,height:10,background:`${C.red}88`,borderRadius:2}}/> Pengeluaran</div>
        </div>
      </div>

      {/* Occupancy Trend Chart */}
      <div style={{...CS.card,padding:20,marginBottom:16}}>
        <div style={{fontWeight:700,fontSize:14,color:C.txt,marginBottom:16}}>🏠 Tren Tingkat Hunian — 12 Bulan</div>
        <div style={{position:'relative',height:120,marginBottom:20}}>
          {/* Grid lines */}
          {[25,50,75,100].map(v=>(
            <div key={v} style={{position:'absolute',left:0,right:0,bottom:`${v}%`,borderTop:'1px dashed #e2e8f0'}}>
              <span style={{fontSize:9,color:C.lite,marginLeft:2}}>{v}%</span>
            </div>
          ))}
          {/* Bars */}
          <div style={{display:'flex',alignItems:'flex-end',height:'100%',gap:4}}>
            {chartData.map((d,i)=>(
              <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',height:'100%',justifyContent:'flex-end'}}>
                <div title={`${d.label}: ${d.occ}%`} style={{width:'100%',background:d.occ>=80?`${C.grn}bb`:d.occ>=50?`${C.amb}bb`:`${C.red}88`,borderRadius:'3px 3px 0 0',height:`${d.occ}%`,minHeight:1,transition:'height 0.4s',display:'flex',alignItems:'flex-start',justifyContent:'center',paddingTop:2}}>
                  {d.occ>0&&<span style={{fontSize:8,color:'#fff',fontWeight:700}}>{d.occ}%</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{display:'flex',gap:4,overflowX:'auto',paddingBottom:4}}>
          {chartData.map((d,i)=>(
            <div key={i} style={{flex:1,fontSize:8,color:C.lite,textAlign:'center',whiteSpace:'nowrap',minWidth:30}}>{d.label}</div>
          ))}
        </div>
      </div>

      {/* Profit/Loss Line */}
      <div style={{...CS.card,padding:20,marginBottom:16}}>
        <div style={{fontWeight:700,fontSize:14,color:C.txt,marginBottom:16}}>📈 Laba/Rugi per Bulan</div>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,minWidth:700}}>
            <thead>
              <tr style={{background:C.bg}}>
                {['Bulan','Pendapatan','Pengeluaran','Laba Bersih','Hunian','Invoice Lunas','Belum Bayar'].map(h=>(
                  <th key={h} style={{padding:'8px 10px',textAlign:'left',fontWeight:700,color:C.mid,fontSize:11,textTransform:'uppercase',whiteSpace:'nowrap'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chartData.slice().reverse().map((d,i)=>(
                <tr key={i} style={{borderTop:`1px solid ${C.bdr}`}}>
                  <td style={{padding:'8px 10px',fontWeight:600,color:d.m===nowMonth()?C.pri:C.txt}}>{d.label}{d.m===nowMonth()&&' ●'}</td>
                  <td style={{padding:'8px 10px',color:C.grn,fontWeight:600}}>{d.rev>0?fmt(d.rev):'—'}</td>
                  <td style={{padding:'8px 10px',color:C.red}}>{d.exp>0?fmt(d.exp):'—'}</td>
                  <td style={{padding:'8px 10px',fontWeight:700,color:d.profit>=0?C.grn:C.red}}>{d.rev||d.exp?fmt(d.profit):'—'}</td>
                  <td style={{padding:'8px 10px'}}><span style={{color:d.occ>=80?C.grn:d.occ>=50?C.amb:C.red,fontWeight:600}}>{d.occ}%</span></td>
                  <td style={{padding:'8px 10px',color:C.grn}}>{d.paid>0?d.paid:'-'}</td>
                  <td style={{padding:'8px 10px',color:d.unpaid>0?C.red:C.lite}}>{d.unpaid>0?d.unpaid:'✓'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── PARSER MUTASI BANK ───────────────────────────────────────────────────────
function parseMutasiCSV(text, bankType) {
  const lines = text.split('\n').map(l=>l.trim()).filter(Boolean)
  const results = []

  // Detect bank from content if not specified
  const header = lines.slice(0,5).join(' ').toLowerCase()
  const bank = bankType ||
    (header.includes('bca') ? 'BCA' :
     header.includes('mandiri') ? 'Mandiri' :
     header.includes('bri') ? 'BRI' :
     header.includes('bni') ? 'BNI' : 'Unknown')

  for (const line of lines) {
    // Skip header rows
    if (/tanggal|date|no\.|keterangan|mutasi|saldo|debet|kredit/i.test(line) && results.length===0) continue
    if (line.split(/[,;]/).length < 3) continue

    // Try comma and semicolon separators
    const cols = line.includes(';') ? line.split(';') : line.split(',')
    if (cols.length < 3) continue

    // Clean a number field
    const parseNum = s => {
      if (!s) return 0
      const n = s.replace(/[^0-9,.-]/g,'').replace(/\./g,'').replace(',','.')
      return Math.abs(parseFloat(n)||0)
    }

    let date='', desc='', credit=0, debit=0

    if (bank==='BCA') {
      // BCA format: Tanggal, Keterangan, Cabang, Jumlah, Saldo
      const rawDate = cols[0]?.trim()
      const m = rawDate?.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
      if (m) {
        const y = m[3].length===2 ? '20'+m[3] : m[3]
        date = `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`
      }
      desc = cols[1]?.trim()||''
      const amt = parseNum(cols[3])
      if (cols[3]?.includes('CR') || (cols[4] && parseNum(cols[4])>parseNum(cols[3]))) credit=amt
      else debit=amt
    } else if (bank==='Mandiri') {
      // Mandiri: Tanggal, Keterangan, Debet, Kredit, Saldo
      const rawDate = cols[0]?.trim()
      const m = rawDate?.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
      if (m) {
        const y = m[3].length===2 ? '20'+m[3] : m[3]
        date = `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`
      }
      desc = cols[1]?.trim()||''
      debit  = parseNum(cols[2])
      credit = parseNum(cols[3])
    } else {
      // Generic: try to find date, desc, amount
      const rawDate = cols[0]?.trim()
      const m = rawDate?.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
      if (m) {
        const y = m[3].length===2 ? '20'+m[3] : m[3]
        date = `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`
      }
      desc = cols[1]?.trim()||''
      // Find the largest number as amount
      for (let i=2; i<Math.min(cols.length,6); i++) {
        const n = parseNum(cols[i])
        if (n > 1000) { credit = n; break }
      }
    }

    if (!date || credit <= 0) continue
    if (isNaN(new Date(date))) continue

    results.push({ date, desc, credit, debit, bank, raw:line })
  }

  return results.sort((a,b)=>a.date.localeCompare(b.date))
}

function matchMutasiToInvoices(mutasiRows, invoices, tenants, rooms) {
  return mutasiRows.map(row => {
    if (row.credit <= 0) return { ...row, status:'skip', matches:[] }

    // Find invoices with similar amount (tolerance 2%)
    const candidates = invoices.filter(inv => {
      if (inv.status === 'paid') return false
      const diff = Math.abs(inv.totalAmount - row.credit) / inv.totalAmount
      return diff <= 0.02
    })

    if (candidates.length === 0) {
      // Check if amount matches any invoice (even paid) — might be duplicate
      const paid = invoices.filter(inv=>inv.status==='paid'&&Math.abs(inv.totalAmount-row.credit)/inv.totalAmount<=0.02)
      return { ...row, status: paid.length>0?'duplicate':'unknown', matches:[], paidMatches:paid }
    }

    // Score each candidate by date proximity + name match in desc
    const scored = candidates.map(inv => {
      const tenant = tenants.find(t=>t.id===inv.tenantId)
      const room   = rooms.find(r=>r.id===inv.roomId)
      let score = 50 // base score for amount match

      // Date proximity (invoice due date vs mutation date)
      if (inv.dueDate) {
        const dayDiff = Math.abs(new Date(row.date) - new Date(inv.dueDate)) / 864e5
        score += dayDiff<=3?30:dayDiff<=7?20:dayDiff<=14?10:0
      }

      // Name in description
      const name = (tenant?.name||'').toLowerCase()
      const firstName = name.split(' ')[0]
      if (firstName.length>2 && row.desc.toLowerCase().includes(firstName)) score += 20

      return { inv, tenant, room, score }
    }).sort((a,b)=>b.score-a.score)

    return {
      ...row,
      status: scored[0].score >= 70 ? 'matched' : 'possible',
      matches: scored.slice(0,3)
    }
  })
}

// ─── MUTASI VIEW ──────────────────────────────────────────────────────────────
function MutasiView({ data, actions, showToast }) {
  const { invoices, tenants, rooms, props } = data
  const [mutasiRows, setMutasiRows]       = useState([])
  const [matched, setMatched]             = useState([])
  const [bankType, setBankType]           = useState('auto')
  const [filterProp, setFilterProp]       = useState('all')
  const [loading, setLoading]             = useState(false)
  const [tab, setTab]                     = useState('all')
  const [confirmed, setConfirmed]         = useState({}) // rowIdx → invId
  const fileRef = useRef()

  const pendingInvoices = invoices.filter(i=>
    i.status!=='paid' &&
    (filterProp==='all' || i.propertyId===filterProp)
  )

  async function handleFile(e) {
    const file = e.target.files[0]; if(!file) return
    setLoading(true)
    const text = await file.text()
    const rows = parseMutasiCSV(text, bankType==='auto'?null:bankType)
    const matchedRows = matchMutasiToInvoices(rows, pendingInvoices, tenants, rooms)
    setMutasiRows(rows)
    setMatched(matchedRows)
    setConfirmed({})
    setLoading(false)
    showToast(`${rows.length} baris mutasi dibaca · ${matchedRows.filter(r=>r.status==='matched').length} cocok otomatis`)
    e.target.value = ''
  }

  async function confirmRow(rowIdx, inv, payDate) {
    await actions.payInvoice(inv.id, `Transfer ${matched[rowIdx]?.bank||''}`, payDate || matched[rowIdx]?.date || todayStr())
    setConfirmed(p=>({...p,[rowIdx]:inv.id}))
    showToast(`✅ ${inv.invNo} dikonfirmasi lunas`)
  }

  async function confirmAll() {
    const autoMatched = matched.filter((r,i)=>r.status==='matched'&&!confirmed[i])
    for (const [i, row] of autoMatched.entries()) {
      const idx = matched.indexOf(row)
      const inv = row.matches[0]?.inv
      if (inv) await confirmRow(idx, inv, row.date)
    }
    showToast(`✅ ${autoMatched.length} pembayaran dikonfirmasi sekaligus!`)
  }

  const statCounts = {
    all: matched.length,
    matched: matched.filter(r=>r.status==='matched').length,
    possible: matched.filter(r=>r.status==='possible').length,
    unknown: matched.filter(r=>r.status==='unknown'||r.status==='duplicate').length,
  }
  const filtered = matched.filter(r=>{
    if (tab==='matched') return r.status==='matched'
    if (tab==='possible') return r.status==='possible'
    if (tab==='unknown') return r.status==='unknown'||r.status==='duplicate'
    return r.status !== 'skip'
  })
  const totalCredit = matched.reduce((s,r)=>s+(r.credit||0),0)
  const autoConfirmable = matched.filter((r,i)=>r.status==='matched'&&!confirmed[i]).length

  return (
    <div>
      <div style={{marginBottom:20}}>
        <h1 style={{margin:0,fontSize:22,fontWeight:800}}>🏦 Rekonsiliasi Mutasi Bank</h1>
        <p style={{margin:'4px 0 0',fontSize:13,color:C.mid}}>Upload CSV mutasi bank → auto-cocokkan dengan invoice → konfirmasi batch</p>
      </div>

      {/* Upload area */}
      {matched.length===0 && (
        <div style={{...CS.card,padding:20,marginBottom:20}}>
          <div style={{fontWeight:700,fontSize:14,marginBottom:14}}>📂 Upload File Mutasi Bank</div>
          <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:14}}>
            <select value={bankType} onChange={e=>setBankType(e.target.value)} style={{...inp(),width:'auto',flex:'none'}}>
              <option value="auto">Deteksi Otomatis</option>
              <option value="BCA">BCA</option>
              <option value="Mandiri">Mandiri</option>
              <option value="BRI">BRI</option>
              <option value="BNI">BNI</option>
            </select>
            <select value={filterProp} onChange={e=>setFilterProp(e.target.value)} style={{...inp(),width:'auto',flex:'none'}}>
              <option value="all">Semua Properti</option>
              {props.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div onClick={()=>fileRef.current.click()} style={{border:'2.5px dashed #c7d2fe',borderRadius:14,padding:'32px 20px',textAlign:'center',cursor:'pointer',background:'#fafafe'}}>
            {loading ? (
              <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:12}}>
                <Spinner size={36}/>
                <div style={{fontSize:13,color:C.mid}}>Membaca dan mencocokkan data...</div>
              </div>
            ) : (
              <>
                <div style={{fontSize:40,marginBottom:10}}>📊</div>
                <div style={{fontWeight:700,fontSize:15,color:C.txt,marginBottom:6}}>Upload CSV Mutasi Bank</div>
                <div style={{fontSize:13,color:C.mid,marginBottom:8}}>Klik atau drag & drop file CSV di sini</div>
                <div style={{fontSize:11,color:C.lite}}>Format: BCA · Mandiri · BRI · BNI · Format umum</div>
              </>
            )}
            <input ref={fileRef} type="file" accept=".csv,.txt" style={{display:'none'}} onChange={handleFile}/>
          </div>

          {/* How to export */}
          <div style={{background:C.ambLt,borderRadius:10,padding:'12px 14px',marginTop:14,fontSize:12,color:C.txt,lineHeight:1.9}}>
            <b>📋 Cara export mutasi dari bank:</b><br/>
            <b>BCA:</b> myBCA / KlikBCA → Rekening → Mutasi → Download CSV<br/>
            <b>Mandiri:</b> Livin / Mandiri Online → Rekening → Riwayat → Export<br/>
            <b>BRI:</b> BRImo → Rekening → Mutasi → Unduh<br/>
            <b>BNI:</b> BNI Mobile → Rekening → Histori → Export
          </div>
        </div>
      )}

      {/* Results */}
      {matched.length>0 && (
        <div>
          {/* Summary */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:12,marginBottom:16}}>
            <StatCard icon="📊" label="Total Mutasi" value={mutasiRows.length+' baris'} sub={`Kredit: ${short(totalCredit)}`} accent={C.pri}/>
            <StatCard icon="✅" label="Cocok Otomatis" value={statCounts.matched} sub="Siap konfirmasi" accent={C.grn}/>
            <StatCard icon="⚠️" label="Perlu Dicek" value={statCounts.possible} sub="Kemungkinan cocok" accent={C.amb}/>
            <StatCard icon="❓" label="Tidak Dikenal" value={statCounts.unknown} sub="Tidak ada invoice" accent={C.mid}/>
          </div>

          {/* Actions */}
          <div style={{display:'flex',gap:10,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
            {autoConfirmable>0&&<button style={btnS('grn')} onClick={confirmAll}>✅ Konfirmasi {autoConfirmable} yang Cocok Sekaligus</button>}
            <button style={btnS('ghost','sm')} onClick={()=>{setMatched([]);setMutasiRows([]);setConfirmed({})}}>↩ Upload Baru</button>
          </div>

          <Tabs tabs={[
            {id:'all',label:'Semua',count:statCounts.all},
            {id:'matched',label:'✅ Cocok',count:statCounts.matched},
            {id:'possible',label:'⚠️ Mungkin',count:statCounts.possible},
            {id:'unknown',label:'❓ Tidak Dikenal',count:statCounts.unknown},
          ]} active={tab} onChange={setTab}/>

          {filtered.length===0&&<Empty icon="✅" title="Tidak ada transaksi di kategori ini"/>}
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {filtered.map((row, i) => {
              const origIdx = matched.indexOf(row)
              const isConfirmed = !!confirmed[origIdx]
              const topMatch = row.matches?.[0]
              const STATUS_COLOR = {
                matched: C.grn, possible: C.amb,
                unknown: C.mid, duplicate: C.red, skip: C.lite
              }
              return (
                <div key={i} style={{...CS.card,padding:'12px 16px',borderLeft:`4px solid ${isConfirmed?C.grn:STATUS_COLOR[row.status]||C.mid}`,opacity:isConfirmed?0.65:1}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:8}}>
                    <div style={{flex:1,minWidth:200}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}>
                        <span style={{fontSize:13,fontWeight:700,color:C.txt}}>{row.date}</span>
                        <span style={{fontSize:12,fontWeight:600,color:C.grn}}>{fmt(row.credit)}</span>
                        <span style={{fontSize:11,background:C.bg,color:C.mid,padding:'1px 8px',borderRadius:99,border:`1px solid ${C.bdr}`}}>{row.bank}</span>
                        {isConfirmed&&<span style={{fontSize:10,background:C.grnLt,color:C.grn,padding:'1px 8px',borderRadius:99,fontWeight:700}}>✅ Dikonfirmasi</span>}
                        {row.status==='duplicate'&&<span style={{fontSize:10,background:C.redLt,color:C.red,padding:'1px 8px',borderRadius:99,fontWeight:700}}>⚠️ Mungkin Duplikat</span>}
                      </div>
                      <div style={{fontSize:12,color:C.mid,marginBottom:6,fontFamily:'monospace',fontSize:11}}>{row.desc}</div>
                      {topMatch&&!isConfirmed&&(
                        <div style={{background:row.status==='matched'?C.grnLt:C.ambLt,borderRadius:8,padding:'6px 10px',fontSize:12}}>
                          <span style={{fontWeight:600,color:row.status==='matched'?C.grn:C.amb}}>
                            {row.status==='matched'?'✅ Cocok:':'⚠️ Kemungkinan:'}
                          </span>
                          {' '}{topMatch.inv.invNo} · {topMatch.tenant?.name||'?'} · {topMatch.room?.number||'?'} · {fmt(topMatch.inv.totalAmount)}
                        </div>
                      )}
                    </div>
                    {!isConfirmed&&topMatch&&(
                      <div style={{display:'flex',gap:6,flexShrink:0,flexDirection:'column',alignItems:'flex-end'}}>
                        <button style={btnS('grn','sm')} onClick={()=>confirmRow(origIdx, topMatch.inv, row.date)}>
                          ✅ Konfirmasi Lunas
                        </button>
                        {row.matches?.length>1&&(
                          <select style={{...inp(),fontSize:11,padding:'4px 8px'}} onChange={e=>{
                            const inv=row.matches.find(m=>m.inv.id===e.target.value)?.inv
                            if(inv) confirmRow(origIdx,inv,row.date)
                          }}>
                            <option value="">Pilih invoice lain...</option>
                            {row.matches.slice(1).map(m=><option key={m.inv.id} value={m.inv.id}>{m.inv.invNo} · {m.tenant?.name} · {fmt(m.inv.totalAmount)}</option>)}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}


// ─── GLOBAL SEARCH ────────────────────────────────────────────────────────────
function GlobalSearch({ data, onClose, setPage }) {
  const [q, setQ] = useState('')
  const inputRef = useRef()
  useEffect(()=>{ inputRef.current?.focus() },[])

  const { props, rooms, tenants, invoices } = data
  const lq = q.toLowerCase().trim()

  const results = lq.length < 2 ? [] : [
    ...tenants.filter(t=>
      t.name.toLowerCase().includes(lq)||t.phone.includes(lq)||t.idNumber?.includes(lq)||t.email?.toLowerCase().includes(lq)
    ).map(t=>{
      const r=rooms.find(x=>x.id===t.roomId), p=props.find(x=>x.id===t.propertyId)
      return { type:'tenant', icon:'👥', label:t.name, sub:`${r?.number||'—'} · ${p?.name||'—'} · ${t.phone}`, id:t.id, page:'tenants' }
    }),
    ...rooms.filter(r=>
      r.number.toLowerCase().includes(lq)||r.type?.toLowerCase().includes(lq)
    ).map(r=>{
      const p=props.find(x=>x.id===r.propertyId)
      const t=tenants.find(x=>x.roomId===r.id&&x.status==='active')
      return { type:'room', icon:'🚪', label:`Kamar ${r.number}`, sub:`${p?.name||'—'} · ${r.type} · ${t?t.name:'Kosong'}`, id:r.id, page:'rooms' }
    }),
    ...invoices.filter(i=>
      i.invNo?.toLowerCase().includes(lq)
    ).map(i=>{
      const t=tenants.find(x=>x.id===i.tenantId)
      return { type:'invoice', icon:'🧾', label:i.invNo, sub:`${t?.name||'—'} · ${fmt(i.totalAmount)} · ${i.status}`, id:i.id, page:'invoices' }
    }),
    ...props.filter(p=>p.name.toLowerCase().includes(lq)||p.address?.toLowerCase().includes(lq))
      .map(p=>({ type:'prop', icon:'🏠', label:p.name, sub:p.address, id:p.id, page:'properties' })),
  ].slice(0,12)

  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:2000,display:'flex',alignItems:'flex-start',justifyContent:'center',paddingTop:80,backdropFilter:'blur(4px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:getC().card,borderRadius:16,width:560,maxWidth:'calc(100vw-32px)',boxShadow:'0 24px 64px rgba(0,0,0,0.3)',overflow:'hidden'}}>
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'14px 16px',borderBottom:`1px solid ${getC().bdr}`}}>
          <span style={{fontSize:18}}>🔍</span>
          <input ref={inputRef} value={q} onChange={e=>setQ(e.target.value)}
            placeholder="Cari penyewa, kamar, invoice, properti..."
            style={{flex:1,border:'none',outline:'none',fontSize:15,background:'transparent',color:getC().txt}}
            onKeyDown={e=>e.key==='Escape'&&onClose()}/>
          {q&&<button onClick={()=>setQ('')} style={{border:'none',background:'none',cursor:'pointer',color:getC().lite,fontSize:16}}>✕</button>}
        </div>
        {q.length>=2&&results.length===0&&(
          <div style={{padding:'32px 16px',textAlign:'center',color:getC().mid,fontSize:13}}>Tidak ada hasil untuk "<b>{q}</b>"</div>
        )}
        {q.length<2&&(
          <div style={{padding:'20px 16px',color:getC().mid,fontSize:13,textAlign:'center'}}>Ketik minimal 2 karakter untuk mencari</div>
        )}
        {results.length>0&&(
          <div style={{maxHeight:400,overflowY:'auto'}}>
            {results.map((r,i)=>(
              <div key={i} onClick={()=>{setPage(r.page);onClose()}}
                style={{display:'flex',alignItems:'center',gap:12,padding:'10px 16px',cursor:'pointer',borderBottom:`1px solid ${getC().bdr}`,background:'transparent'}}
                onMouseEnter={e=>e.currentTarget.style.background=getC().priLt}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <span style={{fontSize:20,flexShrink:0}}>{r.icon}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:600,color:getC().txt}}>{r.label}</div>
                  <div style={{fontSize:11,color:getC().mid,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.sub}</div>
                </div>
                <span style={{fontSize:10,color:getC().lite,background:getC().bg,padding:'2px 8px',borderRadius:99,flexShrink:0}}>
                  {r.type==='tenant'?'Penyewa':r.type==='room'?'Kamar':r.type==='invoice'?'Invoice':'Properti'}
                </span>
              </div>
            ))}
          </div>
        )}
        <div style={{padding:'8px 16px',borderTop:`1px solid ${getC().bdr}`,fontSize:11,color:getC().lite,display:'flex',gap:12}}>
          <span>↵ buka halaman</span><span>Esc tutup</span>
        </div>
      </div>
    </div>
  )
}

// ─── CONTRACT RENEWAL MODAL ───────────────────────────────────────────────────
function RenewalModal({ tenant, room, prop, onRenew, onClose }) {
  const periods = { monthly:1, yearly:12, daily:0, weekly:0 }
  const defMonths = periods[tenant.rentPeriod]||1
  const [months, setMonths] = useState(defMonths||6)
  const [newRent, setNewRent] = useState(tenant.rentAmount)
  const [newDeposit, setNewDeposit] = useState(tenant.depositAmount)

  const currentEnd = new Date(tenant.checkOutDate||todayStr())
  const newEnd = new Date(currentEnd)
  newEnd.setMonth(newEnd.getMonth() + Number(months))
  const newEndStr = newEnd.toISOString().split('T')[0]

  return (
    <Modal title="📋 Perpanjangan Kontrak" subtitle={`${tenant.name} — ${room?.number}`} onClose={onClose} width={460}>
      <div style={{background:getC().priLt,borderRadius:10,padding:'10px 14px',marginBottom:16,fontSize:13,color:getC().pri}}>
        Kontrak saat ini berakhir: <b>{tenant.checkOutDate}</b>
      </div>
      <div style={{marginBottom:14}}>
        <label style={{fontSize:11,fontWeight:700,color:getC().mid,display:'block',marginBottom:6,textTransform:'uppercase'}}>Perpanjang berapa bulan?</label>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
          {[1,3,6,12].map(m=>(
            <button key={m} onClick={()=>setMonths(m)}
              style={{...btnS(months===m?'pri':'ghost','sm'),minWidth:50,justifyContent:'center'}}>
              {m} bln
            </button>
          ))}
        </div>
        <input type="number" value={months} onChange={e=>setMonths(Number(e.target.value))} style={{...inp(),width:120}} min={1} max={36}/>
      </div>
      <FGrid>
        <div>
          <label style={{fontSize:11,fontWeight:700,color:getC().mid,display:'block',marginBottom:5,textTransform:'uppercase'}}>Harga Sewa Baru (Rp)</label>
          <input type="number" value={newRent} onChange={e=>setNewRent(Number(e.target.value))} style={inp()}/>
        </div>
        <div>
          <label style={{fontSize:11,fontWeight:700,color:getC().mid,display:'block',marginBottom:5,textTransform:'uppercase'}}>Deposit (Rp)</label>
          <input type="number" value={newDeposit} onChange={e=>setNewDeposit(Number(e.target.value))} style={inp()}/>
        </div>
      </FGrid>
      <div style={{background:getC().grnLt,borderRadius:10,padding:'12px 14px',margin:'14px 0',fontSize:13}}>
        <div style={{fontWeight:700,color:getC().grn,marginBottom:4}}>✅ Kontrak Baru</div>
        <div style={{color:getC().txt}}>Berakhir: <b>{newEndStr}</b> (+{months} bulan)</div>
        <div style={{color:getC().txt}}>Harga: <b>{fmt(newRent)}/bln</b></div>
      </div>
      {prop&&<div style={{fontSize:12,color:getC().mid,marginBottom:14}}>
        WA konfirmasi akan siap dikirim ke {tenant.name} ({tenant.phone})
      </div>}
      <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
        <button style={btnS('ghost')} onClick={onClose}>Batal</button>
        <button style={btnS('grn')} onClick={()=>onRenew({newEndDate:newEndStr,newRent,newDeposit,months})}>
          ✅ Perpanjang Kontrak
        </button>
      </div>
    </Modal>
  )
}

// ─── ROOM PROFITABILITY VIEW ───────────────────────────────────────────────────
function RoomProfitView({ data }) {
  const { props, rooms, tenants, invoices, expenses } = data
  const [filterProp, setFilterProp] = useState('all')
  const [sortBy, setSortBy] = useState('revenue')

  const months6 = Array.from({length:6},(_,i)=>{
    const d=new Date();d.setMonth(d.getMonth()-(5-i));return d.toISOString().slice(0,7)
  })

  const roomStats = rooms
    .filter(r=>filterProp==='all'||r.propertyId===filterProp)
    .map(r=>{
      const prop = props.find(p=>p.id===r.propertyId)
      const allTenants = tenants.filter(t=>t.roomId===r.id)
      const activeTenant = allTenants.find(t=>t.status==='active')
      const roomInv = invoices.filter(i=>i.roomId===r.id)
      const revenue = roomInv.filter(i=>i.status==='paid').reduce((s,i)=>s+i.totalAmount,0)
      const paidMonths = new Set(roomInv.filter(i=>i.status==='paid').map(i=>i.month)).size
      const unpaid = roomInv.filter(i=>i.status!=='paid').reduce((s,i)=>s+i.totalAmount,0)
      const occupiedMonths = months6.filter(m=>
        allTenants.some(t=>t.checkInDate<=m+'-28'&&(t.checkOutDate>=m+'-01'||!t.checkOutDate))
      ).length
      const occupancyRate = months6.length>0?Math.round(occupiedMonths/months6.length*100):0
      const avgMonthly = paidMonths>0?Math.round(revenue/paidMonths):0
      const potential = (r.pricingPeriods?.monthly||0)*6
      const efficiency = potential>0?Math.round(revenue/potential*100):0
      return { r, prop, activeTenant, revenue, unpaid, occupancyRate, avgMonthly, efficiency, paidMonths }
    })
    .sort((a,b)=>{
      if(sortBy==='revenue') return b.revenue-a.revenue
      if(sortBy==='occupancy') return b.occupancyRate-a.occupancyRate
      if(sortBy==='efficiency') return b.efficiency-a.efficiency
      return b.avgMonthly-a.avgMonthly
    })

  const totalRev = roomStats.reduce((s,x)=>s+x.revenue,0)

  return (
    <div>
      <div style={{marginBottom:20}}>
        <h1 style={{margin:0,fontSize:22,fontWeight:800,color:getC().txt}}>📊 Profitabilitas per Kamar</h1>
        <p style={{margin:'4px 0 0',fontSize:13,color:getC().mid}}>Analisis pendapatan 6 bulan terakhir per kamar</p>
      </div>

      <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:16}}>
        <select value={filterProp} onChange={e=>setFilterProp(e.target.value)} style={{...inp(),width:'auto',flex:'none',background:getC().card,color:getC().txt,borderColor:getC().bdr}}>
          <option value="all">Semua Properti</option>
          {props.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{...inp(),width:'auto',flex:'none',background:getC().card,color:getC().txt,borderColor:getC().bdr}}>
          <option value="revenue">Urutkan: Total Revenue</option>
          <option value="occupancy">Urutkan: Hunian</option>
          <option value="efficiency">Urutkan: Efisiensi</option>
          <option value="avg">Urutkan: Rata-rata/Bulan</option>
        </select>
      </div>

      {/* Summary */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12,marginBottom:20}}>
        <StatCard icon="💰" label="Total Revenue (6bln)" value={short(totalRev)} accent={getC().grn}/>
        <StatCard icon="🏠" label="Kamar Dianalisis" value={roomStats.length} accent={getC().pri}/>
        <StatCard icon="📈" label="Kamar Terbaik" value={roomStats[0]?.r.number||'—'} sub={short(roomStats[0]?.revenue||0)} accent="#7c3aed"/>
        <StatCard icon="⚠️" label="Total Belum Bayar" value={short(roomStats.reduce((s,x)=>s+x.unpaid,0))} accent={getC().red}/>
      </div>

      {/* Table */}
      <div style={{...themeCard(),overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',minWidth:700}}>
          <thead>
            <tr style={{background:getC().bg}}>
              {['Kamar','Properti','Penyewa','Hunian 6bln','Revenue 6bln','Rata-rata/Bln','Efisiensi','Belum Bayar'].map(h=>(
                <th key={h} style={{padding:'10px 12px',textAlign:'left',fontSize:11,fontWeight:700,color:getC().mid,textTransform:'uppercase',whiteSpace:'nowrap'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roomStats.map(({r,prop,activeTenant,revenue,unpaid,occupancyRate,avgMonthly,efficiency},i)=>{
              const barW = totalRev>0?Math.round(revenue/totalRev*100):0
              return (
                <tr key={r.id} style={{borderTop:`1px solid ${getC().bdr}`}}>
                  <td style={{padding:'10px 12px',fontWeight:700,color:getC().txt,whiteSpace:'nowrap'}}>
                    {r.number}
                    <div style={{width:Math.max(barW,1)+'%',height:3,background:`${getC().pri}99`,borderRadius:99,marginTop:4,minWidth:4}}/>
                  </td>
                  <td style={{padding:'10px 12px',fontSize:12,color:getC().mid}}>{prop?.name||'—'}</td>
                  <td style={{padding:'10px 12px',fontSize:12,color:getC().txt}}>{activeTenant?.name||<span style={{color:getC().lite}}>Kosong</span>}</td>
                  <td style={{padding:'10px 12px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:6}}>
                      <div style={{width:40,height:6,background:getC().bdr,borderRadius:99,overflow:'hidden',flexShrink:0}}>
                        <div style={{height:'100%',width:occupancyRate+'%',background:occupancyRate>=80?getC().grn:occupancyRate>=50?getC().amb:getC().red,borderRadius:99}}/>
                      </div>
                      <span style={{fontSize:12,fontWeight:600,color:occupancyRate>=80?getC().grn:occupancyRate>=50?getC().amb:getC().red}}>{occupancyRate}%</span>
                    </div>
                  </td>
                  <td style={{padding:'10px 12px',fontWeight:700,color:getC().grn,whiteSpace:'nowrap'}}>{revenue>0?fmt(revenue):'—'}</td>
                  <td style={{padding:'10px 12px',fontSize:12,color:getC().txt,whiteSpace:'nowrap'}}>{avgMonthly>0?fmt(avgMonthly):'-'}</td>
                  <td style={{padding:'10px 12px'}}>
                    <span style={{fontSize:12,fontWeight:700,color:efficiency>=80?getC().grn:efficiency>=50?getC().amb:getC().mid}}>{efficiency}%</span>
                  </td>
                  <td style={{padding:'10px 12px',color:unpaid>0?getC().red:getC().lite,fontWeight:unpaid>0?700:400,whiteSpace:'nowrap'}}>
                    {unpaid>0?fmt(unpaid):'✓'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}


// ─── BULK ADD ROOMS ───────────────────────────────────────────────────────────
function BulkRoomModal({ props, onSave, onClose }) {
  const [propertyId, setPropertyId] = useState(props[0]?.id||'')
  const [prefix, setPrefix]   = useState('A')
  const [start, setStart]     = useState(1)
  const [count, setCount]     = useState(5)
  const [floor, setFloor]     = useState(1)
  const [type, setType]       = useState('Standard')
  const [monthly, setMonthly] = useState(1500000)
  const [facilities, setFacs] = useState(['AC','WiFi','Kasur','Lemari'])
  const FACS_LIST = ['AC','WiFi','Kasur','Lemari','Meja Belajar','Kursi','Kulkas','TV','Dapur','KM Dalam','KM Luar','Balkon','Water Heater','Mesin Cuci','Parkir Motor','Parkir Mobil']
  const togFac = f => setFacs(p=>p.includes(f)?p.filter(x=>x!==f):[...p,f])
  const preview = Array.from({length:Math.min(count,20)},(_,i)=>`${prefix}-${String(start+i).padStart(2,'0')}`)

  async function doSave() {
    if (!propertyId) return
    const newRooms = preview.map((num,i)=>({
      id: uid(), propertyId, number:num, floor:Number(floor), type, size:'',
      gender:'campur',
      pricingPeriods:{daily:0,weekly:0,monthly:Number(monthly)||0,yearly:Number(monthly)*12||0},
      status:'vacant', facilities:[...facilities], maxTenants:1, photos:[], notes:'',
      createdAt: todayStr()
    }))
    await onSave(newRooms)
  }

  return (
    <Modal title="➕ Bulk Add Kamar" subtitle={`Tambah banyak kamar sekaligus`} onClose={onClose} width={580}>
      <FGrid>
        <Sel label="Properti" value={propertyId} onChange={e=>setPropertyId(e.target.value)}>
          {props.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </Sel>
        <Inp label="Tipe Kamar" value={type} onChange={e=>setType(e.target.value)} placeholder="Standard"/>
      </FGrid>
      <FGrid cols={4}>
        <Inp label="Prefix" value={prefix} onChange={e=>setPrefix(e.target.value)} placeholder="A"/>
        <Inp label="Mulai No." type="number" value={start} onChange={e=>setStart(Number(e.target.value))} min={1}/>
        <Inp label="Jumlah Kamar" type="number" value={count} onChange={e=>setCount(Math.min(50,Number(e.target.value)||1))} min={1} max={50}/>
        <Inp label="Lantai" type="number" value={floor} onChange={e=>setFloor(Number(e.target.value))} min={1}/>
      </FGrid>
      <Inp label="Harga Sewa/Bulan (Rp)" type="number" value={monthly} onChange={e=>setMonthly(e.target.value)}/>
      <Fld label="Fasilitas Default">
        <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:12,marginTop:4}}>
          {FACS_LIST.map(f=>(
            <span key={f} onClick={()=>togFac(f)} style={{padding:'3px 10px',borderRadius:99,fontSize:11,fontWeight:600,cursor:'pointer',background:facilities.includes(f)?C.pri:C.bg,color:facilities.includes(f)?'#fff':C.mid,border:`1.5px solid ${facilities.includes(f)?C.pri:C.bdr}`,transition:'all 0.15s'}}>{f}</span>
          ))}
        </div>
      </Fld>
      <div style={{background:C.priLt,borderRadius:10,padding:'10px 14px',marginBottom:14}}>
        <div style={{fontSize:11,fontWeight:700,color:C.pri,marginBottom:6}}>PREVIEW — {preview.length} kamar akan dibuat:</div>
        <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
          {preview.map(n=><span key={n} style={{background:C.pri,color:'#fff',padding:'2px 8px',borderRadius:6,fontSize:11,fontWeight:700}}>{n}</span>)}
        </div>
      </div>
      <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
        <button style={btnS('ghost')} onClick={onClose}>Batal</button>
        <button style={btnS('pri')} onClick={doSave}>➕ Buat {preview.length} Kamar</button>
      </div>
    </Modal>
  )
}

// ─── BULK EDIT ROOMS ──────────────────────────────────────────────────────────
function BulkEditModal({ rooms, props, onSave, onClose }) {
  const [filterProp, setFilterProp] = useState('all')
  const [selected, setSelected]     = useState(new Set())
  const [editField, setEditField]   = useState('status')
  const [editValue, setEditValue]   = useState('vacant')
  const [editMonthly, setEditMonthly] = useState('')
  const [editFacAdd, setEditFacAdd]   = useState([])
  const [editFacRem, setEditFacRem]   = useState([])

  const filtered = rooms.filter(r=>filterProp==='all'||r.propertyId===filterProp)
  const allSelected = filtered.length>0 && filtered.every(r=>selected.has(r.id))
  const togAll = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(filtered.map(r=>r.id)))
  }
  const tog = id => setSelected(p=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n })

  const FACS_LIST = ['AC','WiFi','Kasur','Lemari','Meja Belajar','Kulkas','TV','KM Dalam','Water Heater','Parkir Motor']
  const togFacAdd = f => setEditFacAdd(p=>p.includes(f)?p.filter(x=>x!==f):[...p,f])
  const togFacRem = f => setEditFacRem(p=>p.includes(f)?p.filter(x=>x!==f):[...p,f])

  async function doApply() {
    if (selected.size===0) return
    const updated = rooms.map(r=>{
      if (!selected.has(r.id)) return r
      const n = {...r}
      if (editField==='status') n.status = editValue
      if (editField==='monthly' && editMonthly) n.pricingPeriods = {...n.pricingPeriods, monthly:Number(editMonthly), yearly:Number(editMonthly)*12}
      if (editField==='facilities') {
        let facs = [...(n.facilities||[])]
        editFacAdd.forEach(f=>{ if(!facs.includes(f)) facs.push(f) })
        editFacRem.forEach(f=>{ facs = facs.filter(x=>x!==f) })
        n.facilities = facs
      }
      return n
    })
    await onSave(updated)
  }

  return (
    <Modal title="✏️ Bulk Edit Kamar" subtitle={`Edit banyak kamar sekaligus`} onClose={onClose} width={620}>
      <div style={{display:'flex',gap:10,marginBottom:12,flexWrap:'wrap'}}>
        <select value={filterProp} onChange={e=>{setFilterProp(e.target.value);setSelected(new Set())}} style={{...inp(),width:'auto',flex:'none'}}>
          <option value="all">Semua Properti</option>
          {props.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button style={btnS(allSelected?'pri':'ghost','sm')} onClick={togAll}>
          {allSelected?'✓ Semua Dipilih':`Pilih Semua (${filtered.length})`}
        </button>
        {selected.size>0&&<span style={{fontSize:12,color:C.pri,fontWeight:700,alignSelf:'center'}}>{selected.size} kamar dipilih</span>}
      </div>

      {/* Room list */}
      <div style={{maxHeight:200,overflowY:'auto',border:`1px solid ${C.bdr}`,borderRadius:10,marginBottom:14}}>
        {filtered.map(r=>{
          const prop = props.find(p=>p.id===r.propertyId)
          return (
            <div key={r.id} onClick={()=>tog(r.id)}
              style={{display:'flex',alignItems:'center',gap:10,padding:'8px 14px',cursor:'pointer',background:selected.has(r.id)?C.priLt:'transparent',borderBottom:`1px solid ${C.bdr}`}}>
              <div style={{width:18,height:18,borderRadius:4,border:`2px solid ${selected.has(r.id)?C.pri:C.bdr}`,background:selected.has(r.id)?C.pri:'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                {selected.has(r.id)&&<span style={{color:'#fff',fontSize:11,fontWeight:800}}>✓</span>}
              </div>
              <div style={{flex:1}}>
                <span style={{fontWeight:600,fontSize:13}}>{r.number}</span>
                <span style={{fontSize:11,color:C.mid,marginLeft:8}}>{prop?.name} · {r.type} · {r.status}</span>
              </div>
              <Badge s={r.status}/>
            </div>
          )
        })}
      </div>

      {/* Edit field selector */}
      <Fld label="Field yang Diedit">
        <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
          {[['status','Status'],['monthly','Harga/Bln'],['facilities','Fasilitas']].map(([v,l])=>(
            <button key={v} onClick={()=>setEditField(v)} style={{...btnS(editField===v?'pri':'ghost','sm')}}>{l}</button>
          ))}
        </div>
      </Fld>

      {editField==='status'&&(
        <Sel label="Status Baru" value={editValue} onChange={e=>setEditValue(e.target.value)}>
          <option value="vacant">Kosong</option><option value="occupied">Terisi</option>
          <option value="maintenance">Maintenance</option><option value="dirty">Perlu Dibersihkan</option>
        </Sel>
      )}
      {editField==='monthly'&&(
        <Inp label="Harga Sewa/Bulan Baru (Rp)" type="number" value={editMonthly} onChange={e=>setEditMonthly(e.target.value)} placeholder="1500000"/>
      )}
      {editField==='facilities'&&(
        <div>
          <Fld label="Tambahkan Fasilitas">
            <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:10}}>
              {FACS_LIST.map(f=><span key={f} onClick={()=>togFacAdd(f)} style={{padding:'3px 10px',borderRadius:99,fontSize:11,fontWeight:600,cursor:'pointer',background:editFacAdd.includes(f)?C.grn:C.bg,color:editFacAdd.includes(f)?'#fff':C.mid,border:`1.5px solid ${editFacAdd.includes(f)?C.grn:C.bdr}`}}>{f}</span>)}
            </div>
          </Fld>
          <Fld label="Hapus Fasilitas">
            <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
              {FACS_LIST.map(f=><span key={f} onClick={()=>togFacRem(f)} style={{padding:'3px 10px',borderRadius:99,fontSize:11,fontWeight:600,cursor:'pointer',background:editFacRem.includes(f)?C.red:C.bg,color:editFacRem.includes(f)?'#fff':C.mid,border:`1.5px solid ${editFacRem.includes(f)?C.red:C.bdr}`}}>{f}</span>)}
            </div>
          </Fld>
        </div>
      )}

      <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:16}}>
        <button style={btnS('ghost')} onClick={onClose}>Batal</button>
        <button style={btnS(selected.size>0?'pri':'ghost')} onClick={doApply} disabled={selected.size===0}>
          ✅ Terapkan ke {selected.size} Kamar
        </button>
      </div>
    </Modal>
  )
}


// ─── RECEIPT SCANNER MODAL — OCR Nota + Auto Expense ─────────────────────────
function ReceiptScanModal({ props, settings, onSave, onClose }) {
  const [step, setStep]           = useState('upload')  // upload|analyzing|result
  const [preview, setPreview]     = useState(null)
  const [base64, setBase64]       = useState(null)
  const [extracted, setExtracted] = useState(null)
  const [error, setError]         = useState('')
  const [saving, setSaving]       = useState(false)
  const fileRef = useRef()
  const camRef  = useRef()

  // Form state — editable after OCR
  const [amount, setAmount]     = useState('')
  const [date, setDate]         = useState(todayStr())
  const [category, setCategory] = useState('Perawatan')
  const [desc, setDesc]         = useState('')
  const [propId, setPropId]     = useState(props[0]?.id||'')

  const EXPENSE_CATS = ['Listrik','Air (PDAM)','Internet/WiFi','Keamanan','Kebersihan','Perawatan','Perbaikan','Pajak','Asuransi','Gaji Pegawai','Lainnya']

  async function handleFile(file) {
    if (!file) return
    if (file.size > 15*1024*1024) { setError('File terlalu besar (max 15MB)'); return }
    setError('')
    try {
      const { dataUrl, base64: b64 } = await resizeForVision(file)
      setPreview(dataUrl)
      setBase64(b64)

      if (!settings?.visionKey) { setStep('result'); return }

      setStep('analyzing')
      const text = await callVisionAPI(b64, settings.visionKey)
      const parsed = parseReceiptText(text)
      setExtracted(parsed)
      if (parsed.amount > 0) setAmount(String(parsed.amount))
      if (parsed.date) setDate(parsed.date)
      if (parsed.category) setCategory(parsed.category)
      if (parsed.desc) setDesc(parsed.desc)

      // Coba Claude API jika ada untuk deskripsi lebih akurat
      if (settings?.claudeKey && b64) {
        const claudeResult = await analyzeWithClaude(b64, settings.claudeKey,
          'Ini adalah foto nota/kwitansi pengeluaran properti kos. Ekstrak dalam format JSON: {"amount": angka, "date": "YYYY-MM-DD", "category": "Listrik|Air (PDAM)|Internet/WiFi|Keamanan|Kebersihan|Perawatan|Perbaikan|Pajak|Asuransi|Gaji Pegawai|Lainnya", "description": "deskripsi singkat max 60 karakter", "vendor": "nama toko/vendor"}. Hanya JSON, tidak ada teks lain.'
        )
        if (claudeResult) {
          try {
            const clean = claudeResult.replace(/```json|```/g,'').trim()
            const parsed2 = JSON.parse(clean)
            if (parsed2.amount > 0) setAmount(String(parsed2.amount))
            if (parsed2.date) setDate(parsed2.date)
            if (parsed2.category) setCategory(parsed2.category)
            if (parsed2.description) setDesc(parsed2.description)
            setExtracted(prev => ({...prev, ...parsed2}))
          } catch(e) {}
        }
      }

      setStep('result')
    } catch(e) {
      setError('Gagal analisis: ' + e.message)
      setStep('result')
    }
  }

  async function doSave() {
    if (!amount || Number(amount) <= 0) { setError('Masukkan nominal yang valid'); return }
    setSaving(true)
    await onSave({
      id: uid(), propertyId: propId, category,
      description: desc || `${category} - dari nota scan`,
      amount: Number(amount),
      date: date || todayStr(),
      isRecurring: false, recurringDay: null,
      status: 'paid',
      proofImage: base64 ? true : false,
      createdAt: todayStr()
    })
    setSaving(false)
    onClose()
  }

  const T = getC()

  return (
    <Modal title="🧾 Scan Nota / Kwitansi" subtitle="AI otomatis baca nominal, tanggal, dan kategori" onClose={onClose} width={600}>

      {/* UPLOAD STEP */}
      {step === 'upload' && (
        <div>
          {error&&<div style={{background:C.redLt,color:C.red,borderRadius:9,padding:'10px 14px',marginBottom:14,fontSize:13}}>{error}</div>}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
            <div onClick={()=>fileRef.current.click()}
              style={{border:`2.5px dashed ${T.bdr}`,borderRadius:14,padding:'32px 16px',textAlign:'center',cursor:'pointer',background:T.bg,transition:'all 0.15s'}}
              onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();handleFile(e.dataTransfer.files[0])}}>
              <div style={{fontSize:40,marginBottom:8}}>🖼️</div>
              <div style={{fontWeight:700,fontSize:13,color:T.txt,marginBottom:4}}>Pilih dari Galeri</div>
              <div style={{fontSize:11,color:T.lite}}>JPG, PNG, PDF · Max 15MB</div>
              <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={e=>handleFile(e.target.files[0])}/>
            </div>
            <div onClick={()=>camRef.current.click()}
              style={{border:`2.5px dashed ${T.grn}55`,borderRadius:14,padding:'32px 16px',textAlign:'center',cursor:'pointer',background:T.grnLt,transition:'all 0.15s'}}>
              <div style={{fontSize:40,marginBottom:8}}>📷</div>
              <div style={{fontWeight:700,fontSize:13,color:T.grn,marginBottom:4}}>Foto Nota Sekarang</div>
              <div style={{fontSize:11,color:T.lite}}>Buka kamera HP / webcam</div>
              <input ref={camRef} type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={e=>handleFile(e.target.files[0])}/>
            </div>
          </div>
          <div style={{background:T.priLt,borderRadius:10,padding:'10px 14px',fontSize:12,color:T.pri,lineHeight:1.8}}>
            <b>🤖 Cara kerja AI Scanner:</b><br/>
            • Google Vision API: baca teks dari foto nota<br/>
            • Claude AI (opsional): interpretasi lebih cerdas — kategori & deskripsi lebih akurat<br/>
            {!settings?.visionKey&&<span style={{color:T.amb}}>⚠️ Vision API Key belum diisi — isi di Pengaturan → AI Bukti Transfer</span>}
            {settings?.visionKey&&!settings?.claudeKey&&<span style={{color:T.mid}}>💡 Tambahkan Claude API Key untuk hasil lebih akurat</span>}
          </div>
        </div>
      )}

      {/* ANALYZING STEP */}
      {step === 'analyzing' && (
        <div style={{textAlign:'center',padding:'40px 20px'}}>
          {preview&&<img src={preview} alt="nota" style={{maxHeight:160,maxWidth:'100%',borderRadius:10,marginBottom:16,boxShadow:'0 4px 16px rgba(0,0,0,0.1)'}}/>}
          <Spinner size={40}/>
          <div style={{fontWeight:700,fontSize:15,color:T.txt,marginTop:16,marginBottom:6}}>🤖 AI membaca nota...</div>
          <div style={{fontSize:13,color:T.mid}}>Mengekstrak nominal, tanggal, dan kategori pengeluaran</div>
          {settings?.claudeKey&&<div style={{fontSize:11,color:T.mid,marginTop:6}}>Claude AI aktif — hasil lebih akurat</div>}
        </div>
      )}

      {/* RESULT STEP */}
      {step === 'result' && (
        <div>
          <div style={{display:'grid',gridTemplateColumns:preview?'180px 1fr':'1fr',gap:16,marginBottom:16}}>
            {preview&&(
              <div>
                <div style={{fontSize:10,fontWeight:700,color:T.mid,marginBottom:6,textTransform:'uppercase'}}>Foto Nota</div>
                <img src={preview} alt="nota" style={{width:'100%',borderRadius:10,border:`1.5px solid ${T.bdr}`,cursor:'pointer'}} onClick={()=>window.open(preview,'_blank')}/>
                <div style={{fontSize:9,color:T.lite,textAlign:'center',marginTop:4}}>Klik untuk perbesar</div>
              </div>
            )}
            <div>
              {extracted?.amount>0&&<div style={{background:T.grnLt,borderRadius:10,padding:'10px 14px',marginBottom:12,fontSize:13}}>
                <div style={{fontSize:10,color:T.mid,fontWeight:700,textTransform:'uppercase',marginBottom:4}}>AI Ekstrak</div>
                <div style={{fontWeight:700,color:T.grn,fontSize:16}}>{fmt(extracted.amount)}</div>
                {extracted.vendor&&<div style={{fontSize:11,color:T.mid,marginTop:2}}>dari: {extracted.vendor}</div>}
              </div>}
              <div style={{fontSize:11,color:T.mid,marginBottom:8,fontWeight:600}}>✏️ Verifikasi & Edit Sebelum Simpan</div>
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                <div>
                  <label style={{fontSize:10,fontWeight:700,color:T.mid,display:'block',marginBottom:4,textTransform:'uppercase'}}>Nominal (Rp)</label>
                  <input type="number" value={amount} onChange={e=>setAmount(e.target.value)} style={{...inp(),fontSize:16,fontWeight:700}} placeholder="0"/>
                </div>
                <FGrid>
                  <div>
                    <label style={{fontSize:10,fontWeight:700,color:T.mid,display:'block',marginBottom:4,textTransform:'uppercase'}}>Tanggal</label>
                    <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={inp()}/>
                  </div>
                  <div>
                    <label style={{fontSize:10,fontWeight:700,color:T.mid,display:'block',marginBottom:4,textTransform:'uppercase'}}>Properti</label>
                    <select value={propId} onChange={e=>setPropId(e.target.value)} style={inp()}>
                      {props.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                </FGrid>
                <div>
                  <label style={{fontSize:10,fontWeight:700,color:T.mid,display:'block',marginBottom:4,textTransform:'uppercase'}}>Kategori</label>
                  <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                    {EXPENSE_CATS.map(cat=>(
                      <span key={cat} onClick={()=>setCategory(cat)}
                        style={{padding:'4px 10px',borderRadius:99,fontSize:11,fontWeight:600,cursor:'pointer',transition:'all 0.15s',
                          background:category===cat?T.pri:T.bg,
                          color:category===cat?'#fff':T.mid,
                          border:`1.5px solid ${category===cat?T.pri:T.bdr}`}}>
                        {cat}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={{fontSize:10,fontWeight:700,color:T.mid,display:'block',marginBottom:4,textTransform:'uppercase'}}>Deskripsi</label>
                  <input value={desc} onChange={e=>setDesc(e.target.value)} style={inp()} placeholder={`${category} - ${date}`}/>
                </div>
              </div>
              {error&&<div style={{background:C.redLt,color:C.red,borderRadius:8,padding:'8px 12px',fontSize:12,marginTop:10}}>{error}</div>}
            </div>
          </div>
          <div style={{display:'flex',gap:10,justifyContent:'space-between',flexWrap:'wrap'}}>
            <button style={btnS('ghost','sm')} onClick={()=>{setStep('upload');setPreview(null);setBase64(null);setExtracted(null)}}>↩ Scan Ulang</button>
            <div style={{display:'flex',gap:8}}>
              <button style={btnS('ghost')} onClick={onClose}>Batal</button>
              <button style={btnS('grn')} onClick={doSave} disabled={saving}>{saving?'⏳ Menyimpan...':'💾 Simpan Pengeluaran'}</button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ─── DAILY SUMMARY PANEL ─────────────────────────────────────────────────────
function DailySummaryPanel({ data, settings, onClose, setPage }) {
  const [summaryItems] = useState(() => generateDailySummary(data))
  const [anomalies]    = useState(() => detectAnomalies(data))
  const [activeTab, setActiveTab] = useState('summary')
  const T = getC()

  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1500,display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(4px)',padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.card,borderRadius:20,width:560,maxWidth:'100%',maxHeight:'88vh',display:'flex',flexDirection:'column',boxShadow:'0 32px 80px rgba(0,0,0,0.25)',overflow:'hidden'}}>

        {/* Header */}
        <div style={{padding:'18px 22px 14px',background:`linear-gradient(135deg,${T.pri},${T.priDk})`,color:'#fff',flexShrink:0}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div>
              <div style={{fontSize:18,fontWeight:900,marginBottom:2}}>🌅 Laporan Pagi</div>
              <div style={{fontSize:12,opacity:0.85}}>{new Date().toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</div>
            </div>
            <button onClick={onClose} style={{background:'rgba(255,255,255,0.2)',border:'none',borderRadius:8,padding:'6px 10px',cursor:'pointer',color:'#fff',fontSize:16}}>✕</button>
          </div>
          <div style={{display:'flex',gap:4,marginTop:14}}>
            {[['summary','📋 Ringkasan'],['anomaly',`🚨 Anomali${anomalies.length>0?` (${anomalies.length})`:''}`]].map(([id,label])=>(
              <button key={id} onClick={()=>setActiveTab(id)}
                style={{padding:'5px 14px',borderRadius:8,border:'none',cursor:'pointer',fontSize:12,fontWeight:700,
                  background:activeTab===id?'rgba(255,255,255,0.25)':'transparent',
                  color:activeTab===id?'#fff':'rgba(255,255,255,0.65)'}}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{flex:1,overflowY:'auto',padding:20}}>

          {/* SUMMARY TAB */}
          {activeTab==='summary'&&(
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              {summaryItems.map((item,i)=>(
                <div key={i} style={{display:'flex',gap:12,alignItems:'flex-start',padding:'10px 14px',borderRadius:12,
                  background:item.alert?`${T.red}12`:T.bg,
                  border:`1px solid ${item.alert?T.red+'33':T.bdr}`}}>
                  <span style={{fontSize:20,flexShrink:0,marginTop:1}}>{item.icon}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:11,fontWeight:700,color:item.alert?T.red:T.mid,textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:2}}>{item.cat}</div>
                    <div style={{fontSize:13,color:item.alert?T.red:T.txt,lineHeight:1.5}}>{item.text}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ANOMALY TAB */}
          {activeTab==='anomaly'&&(
            <div>
              {anomalies.length===0&&(
                <div style={{textAlign:'center',padding:'32px 20px'}}>
                  <div style={{fontSize:48,marginBottom:12}}>✅</div>
                  <div style={{fontWeight:700,color:T.txt,marginBottom:6}}>Semua Normal</div>
                  <div style={{fontSize:13,color:T.mid}}>Tidak ada anomali atau peringatan terdeteksi.</div>
                </div>
              )}
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {anomalies.map((a,i)=>(
                  <div key={i} style={{borderRadius:12,border:`1.5px solid ${a.color}44`,overflow:'hidden'}}>
                    <div style={{background:a.color+'18',padding:'10px 14px',display:'flex',gap:10,alignItems:'flex-start'}}>
                      <span style={{fontSize:22,flexShrink:0}}>{a.icon}</span>
                      <div style={{flex:1}}>
                        <div style={{fontWeight:700,fontSize:13,color:a.color,marginBottom:2}}>{a.title}</div>
                        <div style={{fontSize:12,color:T.mid}}>{a.detail}</div>
                      </div>
                      <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:99,background:a.color,color:'#fff',flexShrink:0,marginTop:2}}>
                        {a.severity==='high'?'TINGGI':'SEDANG'}
                      </span>
                    </div>
                    <div style={{padding:'8px 14px',background:T.bg,borderTop:`1px solid ${a.color}22`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <div style={{fontSize:11,color:T.mid,fontStyle:'italic'}}>💡 {a.suggestion}</div>
                      {a.action&&<button onClick={()=>{setPage(a.action);onClose()}} style={{...btnS('ghost','sm'),fontSize:11}}>Lihat →</button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{padding:'12px 20px',borderTop:`1px solid ${T.bdr}`,flexShrink:0,display:'flex',justifyContent:'space-between',alignItems:'center',background:T.bg}}>
          <div style={{fontSize:11,color:T.lite}}>Diperbarui otomatis setiap hari</div>
          <button onClick={onClose} style={btnS('pri','sm')}>Tutup</button>
        </div>
      </div>
    </div>
  )
}

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function doLogin() {
    if (!email||!pw) { setErr('Email dan password wajib diisi'); return }
    setLoading(true); setErr('')
    const r = await sbSignIn(email, pw)
    if (r.error) { setErr(r.error); setLoading(false) }
    else onLogin(r.user)
  }

  return (
    <div style={{minHeight:'100vh',background:'linear-gradient(135deg,#eef2ff 0%,#f0fdf4 100%)',display:'flex',alignItems:'center',justifyContent:'center',padding:20,fontFamily:'system-ui,sans-serif'}}>
      <div style={{background:'#fff',borderRadius:20,padding:'40px 36px',width:400,maxWidth:'100%',boxShadow:'0 24px 64px rgba(0,0,0,0.12)'}}>
        <div style={{textAlign:'center',marginBottom:28}}>
          <div style={{fontSize:52,marginBottom:8}}>🏠</div>
          <h1 style={{margin:0,fontSize:24,fontWeight:900,color:C.txt}}>KosManager Pro</h1>
          <p style={{margin:'6px 0 0',fontSize:13,color:C.mid}}>Masuk ke akun Anda</p>
        </div>
        {err&&<div style={{background:C.redLt,color:C.red,borderRadius:9,padding:'10px 14px',fontSize:13,marginBottom:14,fontWeight:500}}>{err}</div>}
        <div style={{marginBottom:14}}>
          <label style={{fontSize:11,fontWeight:700,color:C.mid,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.04em'}}>Email</label>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} style={inp()} placeholder="email@example.com" onKeyDown={e=>e.key==='Enter'&&doLogin()}/>
        </div>
        <div style={{marginBottom:20}}>
          <label style={{fontSize:11,fontWeight:700,color:C.mid,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.04em'}}>Password</label>
          <input type="password" value={pw} onChange={e=>setPw(e.target.value)} style={inp()} placeholder="••••••••" onKeyDown={e=>e.key==='Enter'&&doLogin()}/>
        </div>
        <button style={{...btnS('pri','lg'),width:'100%',justifyContent:'center'}} onClick={doLogin} disabled={loading}>{loading?<><Spinner size={16}/> Memuat...</>:'🔐 Masuk'}</button>
        <p style={{marginTop:16,fontSize:11,color:C.lite,textAlign:'center'}}>KosManager Pro v3.0 · Manajemen Properti Indonesia</p>
      </div>
    </div>
  )
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser]       = useState(null)
  const [page, setPage]       = useState('dashboard')
  const [sideOpen, setSideOpen] = useState(window.innerWidth > 768)
  const [toast, setToast]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(null)
  const [data, setData]       = useState({ props:[], rooms:[], tenants:[], invoices:[], expenses:[], charges:[], maint:[], meters:[], settings:{} })
  const [dark, setDark]       = useState(() => localStorage.getItem('km_dark')==='1')

  const showToast = useCallback((msg, type='success') => {
    setToast({msg,type}); setTimeout(()=>setToast(null), 3200)
  }, [])

  // Auth init
  useEffect(() => {
    sbGetUser().then(u => { setUser(u); if(!u) setLoading(false) })
    const splash = document.getElementById('splash')
    if (splash) splash.style.display = 'none'
    // Keyboard shortcuts
    const onKey = e => {
      if ((e.metaKey||e.ctrlKey) && e.key==='k') { e.preventDefault(); setSearchOpen(s=>!s) }
      if (e.key==='Escape') setSearchOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Load data after login
  useEffect(() => {
    if (!user) { setLoading(false); return }
    setLoading(true); setLoadErr(null)
    Promise.all(Object.values(SK).map(k => dbGet(k))).then(vals => {
      const keys = Object.keys(SK)
      const loaded = {}
      keys.forEach((k,i) => {
        if (k==='settings') loaded[k] = vals[i]&&typeof vals[i]==='object'&&!Array.isArray(vals[i]) ? vals[i] : DEFAULT_SETTINGS
        else loaded[k] = Array.isArray(vals[i]) ? vals[i] : (SEED[k]||[])
      })
      setData(loaded); setLoading(false)
    }).catch(e => { setLoadErr(e.message); setLoading(false) })
  }, [user])

  // Persist helper with optimistic update
  const persist = useCallback(async (key, arr) => {
    setData(d => ({...d,[key]:arr}))
    const ok = await dbSet(SK[key], arr)
    if (!ok) showToast('Gagal menyimpan ke server!','error')
  }, [showToast])

  const actions = useMemo(() => ({
    saveProperty: async p => { const a=[...data.props.filter(x=>x.id!==p.id),p]; await persist('props',a) },
    deleteProperty: async id => persist('props', data.props.filter(x=>x.id!==id)),
    saveRoom: async r => {
      const a = [...data.rooms.filter(x=>x.id!==r.id), r]
      await persist('rooms', a)
    },
    deleteRoom: async id => persist('rooms', data.rooms.filter(x=>x.id!==id)),
    saveTenant: async t => {
      const a = [...data.tenants.filter(x=>x.id!==t.id), t]
      await persist('tenants', a)
      // Sync room status
      const rooms2 = data.rooms.map(r => {
        if (r.id===t.roomId) return {...r, status:t.status==='active'?'occupied':r.status==='occupied'?'vacant':r.status}
        if (t.status==='checkedout') { const old=data.tenants.find(x=>x.id===t.id); if(old?.roomId===r.id&&r.status==='occupied') return {...r,status:'vacant'} }
        return r
      })
      await persist('rooms', rooms2)
    },
    deleteTenant: async id => persist('tenants', data.tenants.filter(x=>x.id!==id)),
    saveInvoice: async inv => {
      const a = [...data.invoices.filter(x=>x.id!==inv.id), inv]
      await persist('invoices', a)
      if (inv.items) {
        const cIds = inv.items.filter(it=>it.chargeId).map(it=>it.chargeId)
        if (cIds.length>0) await persist('charges', data.charges.map(c=>cIds.includes(c.id)?{...c,billed:true,invoiceId:inv.id}:c))
      }
    },
    deleteInvoice: async id => persist('invoices', data.invoices.filter(x=>x.id!==id)),
    payInvoice: async (id, method, date) => persist('invoices', data.invoices.map(i=>i.id===id?{...i,status:'paid',paymentMethod:method,paidDate:date}:i)),
    saveExpense: async e => persist('expenses', [...data.expenses.filter(x=>x.id!==e.id), e]),
    deleteExpense: async id => persist('expenses', data.expenses.filter(x=>x.id!==id)),
    saveMaint: async m => persist('maint', [...data.maint.filter(x=>x.id!==m.id), m]),
    deleteMaint: async id => persist('maint', data.maint.filter(x=>x.id!==id)),
    saveMeter: async m => persist('meters', [...data.meters.filter(x=>x.id!==m.id), m]),
    deleteMeter: async id => persist('meters', data.meters.filter(x=>x.id!==id)),
    saveKey: async (key, val) => { setData(d=>({...d,[key]:val})); await dbSet(SK[key], val) },
    restoreAll: async d => {
      for (const k of Object.keys(SK)) { if(d[k]) await dbSet(SK[k], d[k]) }
      setData(d2=>({...d2,...Object.fromEntries(Object.keys(SK).filter(k=>d[k]).map(k=>[k,d[k]]))}))
    }
  }), [data, persist])

  const nav = [
    {id:'dashboard',icon:'📊',label:'Dashboard'},
    {id:'calendar',icon:'📅',label:'Kalender'},
    {id:'properties',icon:'🏠',label:'Properti'},
    {id:'rooms',icon:'🚪',label:'Kamar & Unit'},
    {id:'tenants',icon:'👥',label:'Penyewa'},
    {id:'invoices',icon:'🧾',label:'Tagihan'},
    {id:'mutasi',icon:'🏦',label:'Mutasi Bank'},
    {id:'expenses',icon:'💸',label:'Pengeluaran'},
    {id:'meters',icon:'⚡',label:'Meteran'},
    {id:'maintenance',icon:'🔧',label:'Maintenance'},
    {id:'analytics',icon:'📈',label:'Analitik'},
    {id:'roomprofit',icon:'💹',label:'Per Kamar'},
    {id:'reports',icon:'📋',label:'Laporan'},
    {id:'backup',icon:'💾',label:'Backup & Data'},
    {id:'settings',icon:'⚙️',label:'Pengaturan'}
  ]
  const overdueCount  = data.invoices.filter(i=>i.status==='overdue'||(i.status==='unpaid'&&i.dueDate<todayStr())).length
  const maintCount    = data.maint.filter(m=>m.status!=='done').length
  const expiringCount = data.tenants.filter(t=>t.status==='active'&&dLeft(t.checkOutDate)<=14&&dLeft(t.checkOutDate)>0).length
  const totalAlerts   = overdueCount + maintCount + expiringCount
  const todayDue     = data.invoices.filter(i=>i.status==='unpaid'&&i.dueDate===todayStr())
  const [dismissReminder, setDismissReminder] = useState(false)
  const [searchOpen,     setSearchOpen]     = useState(false)
  const [searchQuery,    setSearchQuery]    = useState('')
  const [summaryOpen,    setSummaryOpen]    = useState(false)
  const [summaryShownToday, setSummaryShownToday] = useState(false)

  if (!user&&!loading) return <LoginScreen onLogin={setUser}/>

  if (loading) return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:C.bg,fontFamily:'system-ui,sans-serif'}}>
      <GlobalStyles dark={dark}/>
      <div style={{textAlign:'center'}}>
        <Spinner size={48}/>
        <div style={{fontSize:14,color:C.mid,marginTop:16}}>Memuat data...</div>
      </div>
    </div>
  )

  if (loadErr) return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:C.bg,fontFamily:'system-ui,sans-serif',padding:20}}>
      <GlobalStyles dark={dark}/>
      <div style={{textAlign:'center'}}>
        <div style={{fontSize:48,marginBottom:12}}>⚠️</div>
        <div style={{fontSize:16,fontWeight:700,marginBottom:8}}>Gagal memuat data</div>
        <div style={{fontSize:13,color:C.mid,marginBottom:20,maxWidth:400}}>{loadErr}</div>
        <button style={btnS('pri')} onClick={()=>window.location.reload()}>🔄 Coba Lagi</button>
      </div>
    </div>
  )

  // Sync dark mode global
  useEffect(() => { _dark = dark; localStorage.setItem('km_dark', dark?'1':'0') }, [dark])
  const T = dark ? DC : C   // Active theme shortcut

  // WA Reminder scheduler (runs while tab is open)
  useReminderScheduler(data, showToast)

  // Auto-show daily summary once per day
  useEffect(() => {
    if (!user || loading || summaryShownToday) return
    const todayKey = todayStr()
    const lastShown = localStorage.getItem('km_summary_date')
    if (lastShown !== todayKey && data.settings?.dailySummaryEnabled !== false) {
      const timer = setTimeout(() => {
        setSummaryOpen(true)
        setSummaryShownToday(true)
        localStorage.setItem('km_summary_date', todayKey)
      }, 2000)  // Show 2 seconds after load
      return () => clearTimeout(timer)
    }
  }, [user, loading, data.invoices.length])

  const vProps = { data, actions, showToast, setPage, dark }
  const views = {
    dashboard:   <DashboardView {...vProps}/>,
    calendar:    <CalendarView {...vProps}/>,
    properties:  <PropertiesView {...vProps}/>,
    rooms:       <RoomsView {...vProps}/>,
    tenants:     <TenantsView {...vProps}/>,
    invoices:    <InvoicesView {...vProps}/>,
    mutasi:      <MutasiView {...vProps}/>,
    expenses:    <ExpensesView {...vProps}/>,
    meters:      <MetersView {...vProps}/>,
    maintenance: <MaintenanceView {...vProps}/>,
    analytics:   <AnalyticsView {...vProps}/>,
    roomprofit:  <RoomProfitView {...vProps}/>,
    reports:     <ReportsView {...vProps}/>,
    backup:      <BackupView {...vProps}/>,
    settings:    <SettingsView {...vProps} user={user}/>
  }

  return (
    <div style={{display:'flex',minHeight:'100vh',background:C.bg}}>
      <GlobalStyles dark={dark}/>
      {/* Sidebar */}
      <div className="no-print" style={{width:sideOpen?220:60,background:C.side,flexShrink:0,display:'flex',flexDirection:'column',transition:'width 0.2s',overflowX:'hidden',position:'sticky',top:0,height:'100vh',zIndex:100}}>
        <div style={{padding:sideOpen?'16px 14px 12px':'12px 10px',borderBottom:'1px solid rgba(255,255,255,0.08)',display:'flex',alignItems:'center',justifyContent:sideOpen?'space-between':'center',gap:8}}>
          {sideOpen&&<div><div style={{fontSize:14,fontWeight:800,color:'#fff'}}>🏠 KosManager</div><div style={{fontSize:9,color:'#64748b',marginTop:1}}>Pro v3{dark?' 🌙':''}</div></div>}
          <div style={{display:'flex',gap:4}}>
            {sideOpen&&<button onClick={()=>setSummaryOpen(true)} title="Laporan Pagi" style={{background:'rgba(255,255,255,0.07)',border:'none',borderRadius:8,padding:'6px 8px',cursor:'pointer',color:'#94a3b8',fontSize:14}}>🌅</button>}
            {sideOpen&&<button onClick={()=>setSearchOpen(true)} title="Cari..." style={{background:'rgba(255,255,255,0.07)',border:'none',borderRadius:8,padding:'6px 8px',cursor:'pointer',color:'#94a3b8',fontSize:14}}>🔍</button>}
            <button onClick={()=>setSideOpen(x=>!x)} style={{background:'rgba(255,255,255,0.07)',border:'none',borderRadius:8,padding:'6px 8px',cursor:'pointer',color:'#94a3b8',fontSize:16,flexShrink:0}}>☰</button>
          </div>
        </div>
        <nav style={{flex:1,padding:'8px 6px',overflowY:'auto'}}>
          {nav.map(n => {
            const badge = n.id==='invoices'?overdueCount:n.id==='maintenance'?maintCount:n.id==='tenants'?expiringCount:n.id==='dashboard'?totalAlerts:0
            return (
              <button key={n.id} onClick={()=>setPage(n.id)} title={!sideOpen?n.label:''}
                style={{width:'100%',display:'flex',alignItems:'center',gap:10,padding:sideOpen?'10px 12px':'10px 0',justifyContent:sideOpen?'flex-start':'center',background:page===n.id?'rgba(79,70,229,0.22)':'transparent',border:'none',borderRadius:9,cursor:'pointer',color:page===n.id?'#a5b4fc':'#94a3b8',fontSize:13,fontWeight:page===n.id?700:400,marginBottom:2,transition:'all 0.15s',position:'relative'}}>
                <span style={{fontSize:16,flexShrink:0}}>{n.icon}</span>
                {sideOpen&&<span style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{n.label}</span>}
                {badge>0&&<span style={{background:C.red,color:'#fff',fontSize:9,fontWeight:800,padding:'1px 5px',borderRadius:99,marginLeft:'auto',flexShrink:0}}>{badge}</span>}
              </button>
            )
          })}
        </nav>
        <div style={{padding:sideOpen?'12px 14px':'8px',borderTop:'1px solid rgba(255,255,255,0.08)'}}>
          {sideOpen&&user&&<div style={{fontSize:10,color:'#64748b',marginBottom:6,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{user.email}</div>}
          {sideOpen&&<div style={{display:'flex',gap:6,marginBottom:6}}>
            <button onClick={()=>setDark(d=>!d)} style={{...btnS('ghost','sm'),color:'#94a3b8',flex:1,justifyContent:'center',fontSize:14}}>
              {dark?'☀️ Light':'🌙 Dark'}
            </button>
          </div>}
          <button onClick={async()=>{await sbSignOut();setUser(null)}} title="Keluar"
            style={{...btnS('ghost','sm'),color:'#94a3b8',width:'100%',justifyContent:sideOpen?'flex-start':'center',padding:'8px 10px'}}>
            🚪{sideOpen&&' Keluar'}
          </button>
        </div>
      </div>

      {/* Main */}
      <main style={{flex:1,overflow:'auto',padding:20,minWidth:0}}>
        {/* Reminder Banner - tagihan jatuh tempo hari ini */}
        {todayDue.length>0&&!dismissReminder&&(
          <div style={{background:`linear-gradient(135deg,${C.amb},#b45309)`,borderRadius:12,padding:'12px 16px',marginBottom:16,display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap',boxShadow:'0 4px 12px rgba(217,119,6,0.3)'}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <span style={{fontSize:20}}>🔔</span>
              <div>
                <div style={{fontWeight:700,fontSize:13,color:'#fff'}}>{todayDue.length} tagihan jatuh tempo HARI INI</div>
                <div style={{fontSize:11,color:'rgba(255,255,255,0.85)'}}>
                  {todayDue.slice(0,3).map(i=>{const t=data.tenants.find(x=>x.id===i.tenantId);return t?.name||'?'}).join(', ')}
                  {todayDue.length>3&&` +${todayDue.length-3} lainnya`}
                </div>
              </div>
            </div>
            <div style={{display:'flex',gap:8}}>
              <button style={{...btnS('ghost','sm'),background:'rgba(255,255,255,0.2)',color:'#fff',border:'none'}} onClick={()=>setPage('invoices')}>Lihat Tagihan</button>
              <button style={{...btnS('ghost','sm'),background:'rgba(255,255,255,0.1)',color:'#fff',border:'none',padding:'5px 8px'}} onClick={()=>setDismissReminder(true)}>✕</button>
            </div>
          </div>
        )}
        {views[page] || <Empty icon="🔍" title="Halaman tidak ditemukan"/>}
      </main>

      {toast&&<Toast msg={toast.msg} type={toast.type}/>}
      {searchOpen&&<GlobalSearch data={data} onClose={()=>setSearchOpen(false)} setPage={setPage}/>}
      {summaryOpen&&<DailySummaryPanel data={data} settings={data.settings} onClose={()=>setSummaryOpen(false)} setPage={setPage}/>}
    </div>
  )
}
