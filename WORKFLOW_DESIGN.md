# طرح workflow و محاسبهٔ پیشرفت

**طرح است، موتور اجرا هنوز وجود ندارد.**

## مدل و transitions

plan یک DAG نسخه‌دار از وظایف وزن‌دار است؛ هر وابستگی به task همان plan اشاره می‌کند و graph بدون cycle اعتبارسنجی می‌شود. taskهای آماده تنها پس از کامل‌شدن وابستگی‌ها و کنترل مجوز، بودجه و approval در صف قرار می‌گیرند. پیشنهاد وضعیت run: `draft → ready → running → completed|failed`؛ `running → pausing → paused → running`؛ `ready|running|paused → cancel_requested → cancelled` پس از توقف/انقضا و پاک‌سازی؛ terminal تغییرناپذیر مگر ایجاد run جدید. وظیفه: `pending → ready → running → succeeded|failed|waiting_approval|cancelled` با retry محدود طبق سیاست. نام دقیق و همهٔ transitionهای مجاز باید پیش از اجرا در جدول قرارداد تثبیت و آزموده شوند.

هر transition با CAS و event و outbox در تراکنش انجام شود. worker با lease منقضی‌شونده و fencing token به کار گماشته می‌شود؛ پس از crash، lease جدید با fence بالاتر می‌آید و worker قدیمی نمی‌تواند state را commit کند. checkpoint نسخه‌دار همراه checksum و artifactهای مجاز ثبت می‌شود. side effect بیرونی به‌طور ذاتی exactly-once نیست: ابزار باید idempotency key پشتیبانی کند یا پیش از retry وضعیت را reconcile کند؛ در حالت مبهم به بررسی انسان برود. retry با backoff/jitter، سقف attempt و طبقه‌بندی خطا، بدون retry خودکار عمل غیرقابل‌تکرار.

approval به digest دقیق عمل، scope، actor، revision و expiry بسته و به‌طور اتمیک مصرف می‌شود؛ تغییر درخواست آن را باطل می‌کند. pause از صدور کار جدید جلوگیری می‌کند ولی کار در حال اجرا تا checkpoint/توقف تأییدشده همچنان running است؛ cancel_requested به معنی cancelled نیست. logهای مرتب با cursor و recovery به UI می‌رسند؛ reconnect با backfill و نمایش قطع ارتباط.

## پیشرفت واقعی

برای plan فعال: مجموع وزن taskهایی که واقعاً succeeded و وابستگی‌های لازمشان تکمیل شده‌اند تقسیم بر مجموع وزن taskهای معتبر × ۱۰۰؛ وزن باید مثبت و finite باشد. بدون task یا مجموع معتبر، مقدار «نامشخص» است. ویرایش plan revision جدید می‌سازد و نتیجهٔ revision قبلی را بی‌دلیل به جدید منتقل نمی‌کند. checklist دستی موجود صرفاً پیشرفت دستی خود را نشان می‌دهد، نه کار انجام‌شدهٔ ایجنت. تغییرات، retry، blocked و approval در event ثبت می‌شوند و هیچ زمان یا نتیجه‌ای شبیه‌سازی نمی‌شود.

## آزمون‌های لازم

DAG cycle/tenant، هم‌زمانی start/stop، lease timeout/fencing، تکرار و crash در هر نقطهٔ تراکنش، failure network، retry مبهم، approval تکراری/منقضی/تغییر یافته، بودجهٔ هم‌زمان، ordering/replay، pause/cancel و محاسبهٔ وزن/طرح خالی. شواهد و تست‌های عملی در `TEST_REPORT.md` جدا از این فهرست است.
