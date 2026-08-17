# إعداد مَقْلَمَة على Supabase الجديد

1. افتح Supabase > SQL Editor.
2. أنشئ New query.
3. انسخ محتوى `supabase.sql` كاملًا ثم Run.
4. من Authentication > Users أنشئ أول حساب Admin باستخدام بريد إلكتروني حقيقي وكلمة مرور قوية.
5. بعد إنشاء المستخدم، نفّذ في SQL Editor (استبدل البريد):

```sql
update public.profiles
set role = 'admin'
where email = 'YOUR_ADMIN_EMAIL';

update public.user_roles
set role = 'admin'
where user_id = (select id from public.profiles where email = 'YOUR_ADMIN_EMAIL');
```

6. لا تضع Service Role / Secret Key داخل `env.js` أو المتصفح.
7. شغّل المشروع واستخدم اسم المستخدم الموجود في `profiles.username` وكلمة المرور التي أنشأتها في Auth.

ملاحظة: النسخة الحالية لا تنشئ Admin تلقائيًا من المتصفح. هذا مقصود لأمان الصلاحيات.
