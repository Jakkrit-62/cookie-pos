# Cookie POS — Offline-First iPad POS (PWA)

ระบบขายหน้าร้านสำหรับ iPad ที่ทำงานได้ **100% แม้ไม่มีอินเทอร์เน็ต** โฮสต์ฟรีบน **GitHub Pages** และ Sync บิลไปที่ **Google Sheets** อัตโนมัติเมื่อออนไลน์

| ไฟล์ | หน้าที่ |
|---|---|
| `index.html` | โครงหน้าจอ (Top bar, เมนู 70%, ตะกร้า 30%, Modals ทั้งหมด) |
| `styles.css` | ธีม Burgundy `#862d28` / Cream `#f7f0dd` + สไตล์สำหรับจอสัมผัส (ทำงานได้แม้ Tailwind CDN โหลดไม่ได้) |
| `app.js` | State, คำนวณโปรโมชั่น, ตัด/คืนสต็อก, บีบอัดรูป, คิว Sync, Backup |
| `sw.js` | Service Worker — Network-First / Cache-Fallback |
| `manifest.json` | PWA manifest (standalone, landscape) |
| `icons/` | ไอคอนแอป (192, 512, apple-touch-icon) |
| `google-apps-script.gs` | โค้ดฝั่ง Google Sheets (`doPost` / `doGet`) |

ไม่ต้อง build ไม่ต้องติดตั้ง npm — อัปโหลดไฟล์ขึ้น GitHub แล้วใช้งานได้ทันที

---

## 1. Deploy ขึ้น GitHub Pages

1. สร้าง repository ใหม่บน GitHub (เช่น `cookie-pos`) จะเป็น Public หรือ Private (ต้องมี GitHub Pro สำหรับ Private Pages) ก็ได้
2. อัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้ไว้ที่ **root** ของ repo (รวมโฟลเดอร์ `icons/`)
   ```bash
   git init
   git add .
   git commit -m "Cookie POS"
   git branch -M main
   git remote add origin https://github.com/<username>/cookie-pos.git
   git push -u origin main
   ```
3. ไปที่ **Settings ▸ Pages** ▸ Source: **Deploy from a branch** ▸ Branch: `main` / `(root)` ▸ **Save**
4. รอ 1–2 นาที จะได้ URL เช่น `https://<username>.github.io/cookie-pos/`

> ทุก path ในแอปเป็นแบบ relative (`./`) จึงใช้ได้ทั้งแบบ `username.github.io` และ `username.github.io/repo-name/`

## 2. ติดตั้งบน iPad

1. เปิด URL ด้วย **Safari** (ต้องออนไลน์ในครั้งแรก เพื่อให้ Service Worker เก็บไฟล์ไว้ใช้ออฟไลน์)
2. กดปุ่ม **แชร์ (Share)** ▸ **เพิ่มไปยังหน้าจอโฮม (Add to Home Screen)**
3. เปิดแอปจากไอคอนบนหน้าจอโฮม → แอปจะเปิดแบบเต็มจอ แนวนอน
4. แนะนำ: เปิดแอปค้างไว้สักครู่ขณะออนไลน์ แล้วลองเปิด **โหมดเครื่องบิน** เพื่อทดสอบว่าใช้งานออฟไลน์ได้

## 3. ตั้งค่า Google Sheets Sync

1. สร้าง Google Sheet ใหม่ (เช่น ชื่อ `Cookie POS Orders`)
2. เมนู **Extensions (ส่วนขยาย) ▸ Apps Script**
3. ลบโค้ดเดิมใน `Code.gs` ทั้งหมด แล้ววางโค้ดจากไฟล์ `google-apps-script.gs` ▸ กด **Save** 💾
4. เลือกฟังก์ชัน `setup` ในแถบด้านบน ▸ กด **▶ Run** ▸ อนุญาตสิทธิ์ (Review permissions ▸ เลือกบัญชี ▸ Advanced ▸ Go to project ▸ Allow)
   → จะเกิดชีต `Orders`, `Order_Items`, `Sync_Log` อัตโนมัติ
5. (ไม่บังคับ) เลือกฟังก์ชัน `testPost` ▸ Run เพื่อทดสอบ — จะมีบิล `ORD-TEST-...` สถานะ `VOIDED` ปรากฏในชีต (ลบทิ้งได้)
6. กด **Deploy ▸ New deployment** ▸ ไอคอนเฟือง ▸ เลือก **Web app**
   - Description: `POS Sync`
   - Execute as: **Me**
   - Who has access: **Anyone** ← สำคัญ (ถ้าเลือกอย่างอื่น iPad จะส่งข้อมูลไม่ได้)
7. กด **Deploy** ▸ คัดลอก **Web app URL** (ลงท้ายด้วย `/exec`)
8. ในแอป POS: กด **ตั้งค่า / Sync** ▸ วาง URL ▸ **บันทึก** ▸ กด **ทดสอบ** ควรขึ้น "เชื่อมต่อสำเร็จ ✓"

### การแก้ไขโค้ด Apps Script ภายหลัง
ถ้าแก้โค้ด `.gs` ต้อง **Deploy ▸ Manage deployments ▸ ✏️ Edit ▸ Version: New version ▸ Deploy** เพื่อให้ URL เดิมใช้โค้ดใหม่ (ไม่ต้องเปลี่ยน URL ในแอป)

### โครงสร้างชีต
- **Orders** — 1 แถว/บิล: `Order_ID, Status (COMPLETED/VOIDED), Date, Date_Time, Timestamp_ISO, Items_Detail, Subtotal, Promo_Discount, Promo_Detail, Item_Discount, Manual_Discount, Total_Discount, Net_Total, Payment_Method, Cash_Received, Change, Device, Voided_At, Void_Reason, Synced_At`
- **Order_Items** — 1 แถว/รายการสินค้า (รวมน้ำหนักขาย/แถม, ไอศกรีมหลัก, Add-on) เหมาะสำหรับทำ Pivot Table ยอดขายรายเมนู
- **Sync_Log** — บันทึกทุกครั้งที่ iPad ส่งข้อมูล (เก็บล่าสุด 2,000 แถว)

การส่งซ้ำ (retry) **ไม่ทำให้บิลซ้ำ** เพราะสคริปต์ค้นหา `Order_ID` ก่อนเสมอ (upsert)

---

## 4. การใช้งาน

### หน้าขาย
- แตะการ์ดเมนูเพื่อเพิ่มลงตะกร้า — ป้ายมุมขวาบนแสดงสต็อก**ที่ยังขายได้** (หักของที่อยู่ในตะกร้าแล้ว)
- สต็อกหมด → ขึ้น **SOLD OUT** และกดไม่ได้ (ซีเรียลคุกกี้: เมื่อเหลือ < 20 กรัม)
- **ซีเรียลคุกกี้** เปิดหน้าต่างชั่งน้ำหนัก: น้ำหนักขาย (ขั้นต่ำ 20 ก.), น้ำหนักแถม (ฟรี แต่ตัดสต็อก), ส่วนลดรายการ — แตะช่องเพื่อเลือก แล้วพิมพ์ด้วย numpad
- **Gooey Chocolate + Ice Cream** เลือกไอศกรีมหลัก (บังคับ) + Add-on ไอศกรีม (+20฿) + คุกกี้ Gooey (+39฿) + จำนวนเซ็ต
- แก้ไขรายการซีเรียล/Gooey ในตะกร้าได้ด้วยปุ่ม ✏️

### โปรโมชั่นอัตโนมัติ
| โปร | เงื่อนไข | ส่วนลด |
|---|---|---|
| ซอฟต์คุกกี้ 3 ชิ้น 100 | ทุก 3 ชิ้น คละรสได้ | 17฿ / ชุด |
| Osaka Cream Puff 4 ชิ้น 99 | ทุก 4 ชิ้น | 17฿ / ชุด |
| ชูครีม 5 ชิ้น 50 | ทุก 5 ชิ้น | 10฿ / ชุด |

คุกกี้ Gooey ที่เป็น Add-on ราคา 39฿ เสมอ และ **ไม่** ร่วมโปรซอฟต์คุกกี้

### ชำระเงิน
เลือก เงินสด / สแกน QR / ไทยช่วยไทยพลัส → ยืนยัน ระบบจะ
1. สร้างเลขบิล `ORD-YYYYMMDD-XXX` + เวลา ISO และ `DD/MM/YYYY HH:mm:ss`
2. ตัดสต็อกทุกรายการ (รวมกรัมที่แถม, สกู๊ปไอศกรีม, คุกกี้ Gooey)
3. บันทึกประวัติ + เข้าคิว Sync (ส่งทันทีถ้าออนไลน์)

### ยกเลิกบิล (VOID)
**ประวัติบิล & สรุปยอดขาย** ▸ ปุ่ม **ยกเลิกบิล** → คืนสต็อกตามจำนวนที่ตัดไปจริงทุกหน่วย, ไม่นับในยอดขาย, ส่ง `VOID_ORDER` ไป Sheet (หรือเข้าคิวถ้าออฟไลน์)

### ปุ่ม Update App Version (🔄 มุมขวาบน)
ดาวน์โหลดไฟล์แอปเวอร์ชันล่าสุดจาก GitHub Pages แล้วรีโหลด — **ข้อมูลสต็อก บิล รูปภาพ ไม่หาย** (อยู่ใน localStorage / IndexedDB แยกจาก cache ของแอป)

> หลัง push โค้ดใหม่ขึ้น GitHub: เมื่อ iPad ออนไลน์ การเปิดแอปใหม่/กด Update จะได้เวอร์ชันล่าสุดทันที (GitHub Pages อาจใช้เวลา ~1–10 นาทีในการเผยแพร่)
> ถ้าแก้ `sw.js` ควรเปลี่ยน `SW_VERSION` ด้วย เพื่อให้ล้าง cache เก่า

---

## 5. ข้อมูลและการสำรองข้อมูล

| ข้อมูล | ที่เก็บ |
|---|---|
| สต็อก, ประวัติบิล, คิว Sync, ตั้งค่า, ตะกร้าปัจจุบัน | `localStorage` (key ขึ้นต้นด้วย `pos.v1.`) |
| รูปเมนู (JPEG 300×300 ~20–50 KB/รูป) | `IndexedDB` (`pos-images`) |

- **Export Backup (JSON)** — ไฟล์เดียวรวมทุกอย่าง (รวมรูป) บน iPad ใช้ปุ่ม **แชร์ไฟล์ Backup** เพื่อบันทึกลง Files / AirDrop
- **Import Backup (JSON)** — แทนที่ข้อมูลทั้งหมดในเครื่อง (ใช้ย้ายเครื่อง/กู้คืน)
- localStorage จำกัดประมาณ 5 MB (~3,000+ บิล) — ใช้ **ล้างบิลเก่าที่ Sync แล้ว (เกิน 60 วัน)** ในหน้าตั้งค่าเมื่อพื้นที่ใกล้เต็ม (ข้อมูลยังอยู่ใน Google Sheets)
- ⚠️ iPadOS อาจลบข้อมูลเว็บแอปที่ไม่ได้เปิดใช้งานนานหลายสัปดาห์ — แอปขอ `navigator.storage.persist()` ไว้แล้ว แต่ควร Export Backup เป็นประจำ และอย่าลบ "ข้อมูลเว็บไซต์" ของ Safari

### ใช้หลาย iPad พร้อมกัน
เลขบิลรันต่อเนื่องภายในแต่ละเครื่อง หากใช้มากกว่า 1 เครื่องกับ Sheet เดียวกัน ให้ตั้ง **ชื่ออุปกรณ์** ต่างกัน และแนะนำให้แก้ `nextOrderId()` ใน `app.js` ให้มีรหัสเครื่องในเลขบิล (เช่น `ORD-20261114-A001`) เพื่อป้องกันเลขบิลชนกัน

---

## 6. ปรับแต่งเมนู / ราคา

แก้ไขส่วน **CATALOG** ด้านบนของ `app.js`:
- `SOFT_FLAVORS`, `CEREAL_FLAVORS` — ชื่อรส
- `SOFT_PRICE`, `CEREAL_PRICE_PER_G`, `CEREAL_MIN_G`, `GOOEY` — ราคา
- `PROMOS` — ขนาดชุดและส่วนลดต่อชุด
- `PAY_METHODS` — วิธีชำระเงิน

## 7. ทดสอบบนคอมพิวเตอร์

Service Worker ต้องรันผ่าน `http://localhost` หรือ `https://` (เปิดไฟล์ตรง ๆ แบบ `file://` จะใช้งานได้แต่ไม่มีโหมดออฟไลน์)
```bash
python -m http.server 8080
# เปิด http://localhost:8080
```

## 8. Troubleshooting

| อาการ | วิธีแก้ |
|---|---|
| Sync ขึ้น "ตอบกลับไม่ใช่ JSON" | Deploy ใหม่โดยตั้ง **Who has access: Anyone** และใช้ URL ที่ลงท้าย `/exec` |
| Sync ค้างในคิว | ตรวจ URL ▸ กด **ทดสอบ** ▸ ดูข้อความ error ในคิว ▸ ดูชีต `Sync_Log` |
| แอปไม่อัปเดตหลัง push | ตรวจว่าออนไลน์ ▸ กด 🔄 Update App Version ▸ รอ GitHub Pages deploy เสร็จ (แท็บ Actions) |
| ฟอนต์ไม่สวยตอนออฟไลน์ครั้งแรก | เปิดแอปขณะออนไลน์ 1 ครั้งเพื่อให้ฟอนต์ถูก cache |
