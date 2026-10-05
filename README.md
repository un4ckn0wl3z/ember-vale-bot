# Ember Vale Bot

บอท CLI + Dashboard สำหรับ Ember Vale เชื่อมต่อ WebSocket เดียวกับตัวเกมโดยตรงและรันด้วย Node.js ไม่ต้องเปิดเบราว์เซอร์เกม

หากต้องการเห็น gameplay ระหว่างบอททำงาน ให้ใช้เวอร์ชัน Tampermonkey ใน `ember-vale-xp-rush.user.js` และอ่าน `TAMPERMONKEY.md`

## ความสามารถ

- ล่าอัตโนมัติ พร้อมเลือกเป้าหมายจากระดับ ระยะทาง HP และศัตรูที่กำลังโจมตีเรา
- เดินหลบสิ่งกีดขวางและเปลี่ยนโซนตามระดับโดยอัตโนมัติ
- ใช้สกิลบน hotbar, ดื่มยา และหนีเมื่อ HP อันตราย
- กลับเมืองเมื่อยาหมด กระเป๋าเต็ม หรืออุปกรณ์ที่สวมอยู่พัง
- ซื้อยา/Return Scroll, ซ่อมอุปกรณ์ และขายของตาม policy
- ใส่อุปกรณ์ที่มีคะแนนสูงกว่าให้อัตโนมัติ
- Loot policy: ทิ้งตาม rarity, ขายตาม rarity หรือทิ้งอาวุธคนละคลาส
- Build manager: ลง attribute/skill points และจัด hotbar
- Dashboard ที่ `http://127.0.0.1:3210`
- บันทึกเหตุการณ์เป็น JSONL และสรุป session เป็น CSV ในโฟลเดอร์ `logs`
- แจ้งเตือนผ่าน Dashboard/Browser Notification และ webhook (ถ้าตั้งค่า)
- เลือก Expedition ที่ปลอดภัยและให้ XP/h สูงสุดก่อนปิด
- ต่อใหม่อัตโนมัติเมื่อการเชื่อมต่อหลุด

## ต้องมี

- Node.js 22 ขึ้นไป (`node --version`)
- บัญชีฮีโร่ Ember Vale

รหัสผ่านจะไม่ถูกเขียนลงไฟล์ ถ้าไม่ได้ตั้ง `EV_PASSWORD` โปรแกรมจะถามและซ่อนข้อความขณะพิมพ์

## เริ่มใช้งาน

เปิด PowerShell ในโฟลเดอร์นี้:

```powershell
node bot.js --user "ชื่อฮีโร่"
```

จากนั้นเปิด Dashboard ที่ `http://127.0.0.1:3210` ซึ่งสามารถ Pause/Resume, สั่งกลับเมือง, เปิด/ปิดสกิล, ออก Expedition และหยุดบอทได้

## รูปแบบที่แนะนำ

แบบปลอดภัย ไม่ขายหรือทิ้งไอเทมเอง:

```powershell
node bot.js --user "ชื่อฮีโร่"
```

แบบฟาร์มต่อเนื่อง ขาย Common/Uncommon ที่ไม่ใช่อัปเกรด:

```powershell
node bot.js --user "ชื่อฮีโร่" --sell common,uncommon
```

แบบเต็มระบบ พร้อมจัด build และออก Expedition เมื่อหยุด:

```powershell
node bot.js --user "ชื่อฮีโร่" --sell common,uncommon --auto-build --expedition-on-exit
```

แบบเร่งเลเวลสูงสุด:

```powershell
node bot.js --user "ชื่อฮีโร่" --xp-rush --expedition-on-exit
```

`--xp-rush` จะเลือกมอนสเตอร์และโซนจาก XP ต่อเวลาฆ่าโดยประมาณ, ปรับความเสี่ยงตามอัตราการใช้ยาจริง, ใช้ damage-first skill build, เติมยาได้ถึง 80 ขวด และลดเวลาเดินกลับเมืองด้วยการทิ้ง Common/Uncommon ตั้งแต่ดรอป พร้อมขายของระดับดังกล่าวที่ค้างอยู่ในกระเป๋า ตัวเลือกนี้เน้นเลเวลมากกว่าไอเทม

## Environment variables

หลีกเลี่ยงการใส่รหัสผ่านใน command line โดยใช้ environment variable:

```powershell
$env:EV_USER = "ชื่อฮีโร่"
$env:EV_PASSWORD = "รหัสผ่าน"
node bot.js --sell common
```

ล้างรหัสผ่านเมื่อเลิกใช้:

```powershell
Remove-Item Env:EV_PASSWORD
```

ตัวแปรที่รองรับ ได้แก่ `EV_USER`, `EV_PASSWORD`, `EV_TOKEN`, `EV_WS_URL`, `EV_CLASS`, `EV_COLOR`, `EV_TARGETS`, `EV_TRASH`, `EV_SELL`, `EV_ZONES`, `EV_POT_AT`, `EV_FLEE_AT`, `EV_LEVEL_GAP`, `EV_MIN_POTS`, `EV_BUY_POTS`, `EV_MIN_SCROLLS`, `EV_BUY_SCROLLS`, `EV_RESERVE_GOLD`, `EV_DASHBOARD_PORT` และ `EV_WEBHOOK_URL`

## การจัดการไอเทม

Auto-equip เปิดอยู่ตามค่าเริ่มต้นและใช้คะแนนจาก ATK, DEF, HP, critical, attack speed, cooldown reduction, leech, dodge และ block

```powershell
# ปิด Auto-equip
node bot.js --user "ชื่อฮีโร่" --no-auto-equip

# ให้ของต่ำกว่า Rare ถูกทิ้งไว้ตั้งแต่ดรอป
node bot.js --user "ชื่อฮีโร่" --keep-rarity rare

# ขาย Common/Uncommon ที่ไม่ใช่อัปเกรดเมื่อกระเป๋าเต็ม
node bot.js --user "ชื่อฮีโร่" --sell common,uncommon

# ทิ้งอาวุธที่ใช้กับคลาสปัจจุบันไม่ได้
node bot.js --user "ชื่อฮีโร่" --discard-other-class
```

ข้อควรระวัง: `--trash`, `--keep-rarity`, `--sell` และ `--discard-other-class` ทำให้ไอเทมหายอย่างถาวร บอทจะไม่ขายการ์ด ไอเทมที่ใส่การ์ดไว้ หรือชิ้นที่มีคะแนนสูงกว่าของสวมอยู่

## โซนและการต่อสู้

```powershell
# อยู่แผนที่ปัจจุบันเท่านั้น
node bot.js --user "ชื่อฮีโร่" --zones stay

# ล็อกไว้ที่ map id 3
node bot.js --user "ชื่อฮีโร่" --zones 3

# หนีเมื่อ HP ต่ำกว่า 25% และดื่มยาเมื่อ HP ต่ำกว่า 55%
node bot.js --user "ชื่อฮีโร่" --flee-at 0.25 --pot-at 0.55

# โจมตีธรรมดาอย่างเดียว
node bot.js --user "ชื่อฮีโร่" --no-skills
```

`--zones auto` เป็นค่าเริ่มต้น บอทจะเลือกโซนที่มีมอนสเตอร์เหมาะกับระดับและเดินผ่าน portal เอง โดยไม่เลือก Boss, Mini-boss/Champion หรือ Rare เป็นเป้าหมายอัตโนมัติ

## Build manager

```powershell
# ลงเฉพาะ attribute ตาม build สมดุลของเซิร์ฟเวอร์
node bot.js --user "ชื่อฮีโร่" --auto-spend

# ลง attribute + skill และจัด active skills ลง hotbar
node bot.js --user "ชื่อฮีโร่" --auto-build
```

`--auto-build` เปลี่ยน skill build ของฮีโร่จริง จึงปิดไว้ตามค่าเริ่มต้น

## ร้านค้าและเงินสำรอง

ค่าเริ่มต้นจะกลับเมืองเมื่อยาเหลือ 3 ขวด เติมให้ถึง 20 ขวด เก็บ Return Scroll อย่างน้อย 1 ใบ และไม่ใช้เงินต่ำกว่า 100 gold:

```powershell
node bot.js --user "ชื่อฮีโร่" --min-pots 5 --buy-pots 30 --min-scrolls 2 --buy-scrolls 5 --reserve-gold 500
```

ถ้าเงินไม่พอหรือกระเป๋าเต็มแต่ไม่มี policy ที่ขายได้ บอทจะ Pause และแจ้งเตือนแทนการลบของเอง

## การแจ้งเตือน

กด “เปิดการแจ้งเตือน” ใน Dashboard เพื่อรับ Browser Notification ขณะหน้า Dashboard เปิดอยู่

สำหรับ webhook:

```powershell
$env:EV_WEBHOOK_URL = "https://example.com/your-webhook"
node bot.js --user "ชื่อฮีโร่"
```

Webhook จะถูกเรียกเฉพาะเหตุการณ์สำคัญ เช่น ตาย, ถูกเตะ, ได้ Epic/Card, ต้องการให้ผู้เล่นจัดการ หรือการเชื่อมต่อหลุด

## Expedition

สั่งจาก Dashboard ได้ทันที หรือให้ทำก่อนปิดด้วย:

```powershell
node bot.js --user "ชื่อฮีโร่" --expedition-on-exit
```

เมื่อกด `Ctrl+C` บอทจะขอแผนจากเซิร์ฟเวอร์ เลือกโซนที่ปลอดภัยและมี XP/h สูงที่สุด ส่งยาไปทั้งหมด แล้วจึงออก ถ้าเซิร์ฟเวอร์ไม่ตอบภายใน 7 วินาทีจะปิดตามปกติ

## ตรวจสอบการติดตั้ง

```powershell
node bot.js --self-test
node bot.js --help
```

## หมายเหตุ

- อย่าเปิดตัวเกมและบอทด้วยฮีโร่ตัวเดียวกันพร้อมกัน เพราะเซิร์ฟเวอร์อาจตัดหนึ่งในสอง session
- Dashboard ฟังเฉพาะ `127.0.0.1` จึงไม่เปิดให้เครื่องอื่นในเครือข่ายเข้าถึง
- ข้อมูลล็อกอยู่ใน `logs/events-YYYY-MM-DD.jsonl` และ `logs/sessions.csv`
- หากเซิร์ฟเวอร์หรือกติกาเกมเปลี่ยน โปรโตคอลอาจต้องอัปเดตตาม
