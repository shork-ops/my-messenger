# Отложенная настройка Supabase

Пользователь решил вернуться к настройке позднее (5 ноября 2026). В рамках исправлений функции на сервере не разворачивались.

## Порядок действий

1. Создать случайный секрет: node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))".
2. Supabase Dashboard → Edge Functions → Secrets: сохранить его как PUSH_WEBHOOK_SECRET.
3. Database → Webhooks: отредактировать существующий webhook public.messages (INSERT), не создавать дубликат. Метод POST, URL https://PROJECT_REF.supabase.co/functions/v1/push-notify.
4. В HTTP Headers: Content-Type: application/json и Authorization: Bearer <тот же секрет>.
5. Из checkout с исправлениями развернуть:

~~~powershell
npx supabase login
npx supabase functions deploy push-notify --project-ref PROJECT_REF --no-verify-jwt
npx supabase functions deploy link-preview --project-ref PROJECT_REF
npx supabase functions deploy delete-account --project-ref PROJECT_REF --no-verify-jwt
~~~

PROJECT_REF заменить идентификатором проекта. delete-account проверяет пользовательский JWT внутри функции.

Секрет не публиковать в GitHub и не добавлять во фронтенд. При сохранении в webhook он может присутствовать в SQL определения триггера и дампах БД; их тоже хранить как секретные данные.

## Проверка после развёртывания

- VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY и VAPID_SUBJECT уже должны быть настроены; новый секрет их не заменяет.
- Получатель разрешает уведомления и оформляет подписку в приложении.
- На двух аккаунтах: обычное сообщение даёт push; отключённые уведомления чата его подавляют.
- Без правильного Authorization запрос к push-notify возвращает 401.
- Проверить предпросмотр обычной публичной ссылки и удаление тестового аккаунта штатным способом.

## Известное ограничение

INSERT-webhook не является планировщиком: push для будущего сообщения теперь подавляется, чтобы не раскрыть текст заранее. Доставка push в назначенный момент требует отдельного серверного задания; пока она не реализована этим исправлением. Сообщение становится доступно по правилам БД после send_at. Повтор webhook также может дать повторное уведомление: дедупликация требует отдельного механизма.
