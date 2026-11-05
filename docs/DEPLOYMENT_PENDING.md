# Отложенная настройка Supabase

Пользователь решил вернуться к настройке позднее (5 ноября 2026). В рамках исправлений функции на сервере не разворачивались.

## Порядок действий

1. Создать случайный секрет: node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))".
2. Supabase Dashboard → Edge Functions → Secrets: сохранить его как PUSH_WEBHOOK_SECRET.
3. Database → Webhooks: отредактировать существующий webhook public.messages (INSERT), не создавать дубликат. Метод POST, URL https://PROJECT_REF.supabase.co/functions/v1/push-notify.
4. В HTTP Headers: Content-Type: application/json и Authorization: Bearer <тот же секрет>.
5. Выполнить миграцию supabase/migrations/20261059_push_queue.sql в SQL Editor после предыдущих миграций. Она создаёт очередь и триггер; прежние обычные сообщения не рассылаются заново. Будущие отложенные сообщения добавляются в очередь.
6. Из checkout с исправлениями развернуть:

~~~powershell
npx supabase login
npx supabase functions deploy push-dispatch --project-ref PROJECT_REF --no-verify-jwt
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

## Планировщик

После развёртывания создать в Supabase Vault две записи:

- nexus_project_url: https://PROJECT_REF.supabase.co
- nexus_push_webhook_secret: то же значение, что PUSH_WEBHOOK_SECRET.

Затем выполнить supabase/setup/push-cron.sql в SQL Editor. Скрипт включает pg_cron и pg_net и создаёт одно задание nexus-push-dispatch раз в минуту. Повторный запуск обновляет это же задание. При изменении секрета обновить Edge Functions, webhook и Vault.

Проверить отложенное сообщение на двух аккаунтах с закрытой вкладкой получателя. До send_at push не должен приходить; после — придёт при ближайшем запуске планировщика, обычно в пределах минуты плюс время обработки. При очереди более 10 сообщений потребуется несколько запусков.

Мониторинг: Cron → History, Edge Functions → push-dispatch → Logs; ответы HTTP — в net._http_response. Успех Cron означает постановку HTTP-запроса, а не успешную доставку push. В push_jobs проверить задания с completed_at is null и большим attempts. Отключить планировщик можно командой select cron.unschedule('nexus-push-dispatch');.

## Гарантии и ограничения

Очередь хранится в БД, поэтому закрытый браузер отправителя не отменяет уведомление. Webhook ускоряет обычные сообщения, планировщик обрабатывает отложенные и повторяет ошибки с паузой от 1 до 60 минут. Блокировка задания действует 5 минут; после аварийного завершения оно становится доступно снова. Успешные отправки отмечаются по подписке и при обычном повторе пропускаются. Сообщения без получателей/подписок считаются обработанными: подключение нового устройства не запускает рассылку истории.

Между принятием push внешним сервисом и сохранением квитанции остаётся аварийное окно: при сбое в этот момент возможен дубль. Это не гарантия exactly-once. Доставка до устройства также зависит от браузера и push-провайдера. Сообщения, удалённые или истёкшие к моменту обработки, не рассылаются. Изменение сообщения/состава чата одновременно с сетевой отправкой имеет обычное окно гонки.
