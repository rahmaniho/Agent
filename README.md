# Agent

مجموعهٔ منابع مهندسی نرم‌افزار / معماری / طراحی سایت.

## `kit/` — کیت گزیده از ECC

استخراج و گزینش بخش‌های مرتبط با **مهندسی نرم‌افزار، معماری نرم‌افزار و طراحی و ساخت سایت** از ریپوی [affaan-m/ECC](https://github.com/affaan-m/ECC) (نسخهٔ 2.2.3، لایسنس MIT):

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

## `site/` — ECC Playbook (راهنمای خدمت‌محور)

یک سایت فارسی و تک‌صفحه‌ای که کاتالوگ کامل ریپوی ECC (۳۱۴ اسکیل، ۹۸ دستور، ۷۱ agent) را به **نیاز واقعی بازدیدکننده** نگاشت می‌کند: ۱۵ مسیر خدمت، هر کدام با مراحل، جعبه‌ابزار (اسکیل/دستور/agent)، ۳۵+ پرامپت آماده برای کپی و فهرست تله‌های رایج.

```bash
node site/serve.mjs      # http://localhost:4173
```

جزئیات: [`site/README.md`](site/README.md)
