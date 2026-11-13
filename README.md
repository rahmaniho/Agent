# Agent

مجموعهٔ منابع مهندسی نرم‌افزار / معماری / طراحی سایت.

## `kit/` — کیت گزیده از ECC

استخراج و گزینش بخش‌های مرتبط با **مهندسی نرم‌افزار، معماری نرم‌افزار و طراحی و ساخت سایت(نسخهٔ 2.2.3، لایسنس MIT):

- `kit/skills/` — ۶۲ مهارت (فرانت‌اند و طراحی UI، معماری، API، دیتابیس، تست/TDD، امنیت، کارایی، مستندسازی)
- `kit/agents/` — ۲۴ agent تخصصی (architect، code-reviewer، react-reviewer، a11y-architect، seo-specialist و ...)
- `kit/commands/` — ۱۶ اسلش-کامند (`/code-review`, `/feature-dev`, `/plan`, `/quality-gate`, ...)
- `kit/rules/` — قواعد `common`, `web`, `react`, `typescript`
- `kit/CATALOG.md` — فهرست کامل مهارت‌ها با توضیح
- `kit/install-kit.sh` — نصب در `~/.claude` یا مسیر دلخواه (با `--dry-run` و پشتیبان‌گیری)

```bash
cd kit && ./install-kit.sh --dry-run     # پیش‌نمایش
cd kit && ./install-kit.sh               # نصب در ~/.claude
```

جزئیات بیشتر: [`kit/README.md`](kit/README.md)

## `site/` — ECC Playbook (وب‌اپ خدمت‌محور)

وب‌اپ فارسی/RTL که کاتالوگ کامل ریپوی ECC (۳۱۴ اسکیل، ۹۸ دستور، ۷۱ agent) را به **نیاز واقعی بازدیدکننده** نگاشت می‌کند: ۱۵ مسیر خدمت، هر کدام با مراحل، جعبه‌ابزار (اسکیل/دستور/agent)، ۳۸ پرامپت آماده برای کپی، فهرست تله‌های رایج و خروجی مورد انتظار.

**آنلاین:** <https://rahmaniho.github.io/Agent/> — استقرار خودکار با GitHub Pages (`.github/workflows/pages.yml`).

```bash
node site/serve.mjs      # http://localhost:4173
```

کاتالوگ کامل فعلی در پایگاه دادهٔ محافظت‌شده نگهداری می‌شود؛ فقط نمونه‌ها در سایت استاتیک قرار دارند. نسخه‌های قبلی و منابع متن‌باز این مخزن همچنان عمومی‌اند و نمی‌توان آنها را محرمانه تلقی کرد. جزئیات و نحوهٔ پشتیبان‌گیری خصوصی: [`site/README.md`](site/README.md).

## `free-claude-code/` — سورس Free Claude Code

نسخهٔ کامل فایل‌های مخزن [Alishahryar1/free-claude-code](https://github.com/Alishahryar1/free-claude-code) در کامیت `56621010ada15b633d76ab19178764bb3e81bcc5`، به صورت snapshot داخل این مخزن قرار گرفته است. پوشهٔ Git داخلی و تاریخچه عمداً حذف شده‌اند تا فایل‌ها بخشی از همین مخزن باشند، نه یک submodule. مجوز پروژه **AGPL-3.0-only** است؛ متن کامل و اعلان حق نشر در [`free-claude-code/LICENSE`](free-claude-code/LICENSE) حفظ شده است.

داشبورد فارسی در `site/` راهنمای شروع FCC را هم نمایش می‌دهد؛ خود سایت استاتیک است و سرور یا مدل را اجرا نمی‌کند. برای نصب و پیکربندی ارائه‌دهنده و اجرای ایجنت، [راهنمای رسمی FCC](https://github.com/Alishahryar1/free-claude-code#quick-start) را دنبال کنید. محدودیت‌ها و شرایط پلن رایگان بسته به ارائه‌دهنده متغیر است. از آنجا که snapshot تاریخچهٔ Git ندارد و پروژهٔ بالادستی از `hatch-vcs` برای نسخه‌گذاری استفاده می‌کند، برای نصب از سورس بهتر است از کلون مستقل مخزن بالادستی استفاده کنید.
