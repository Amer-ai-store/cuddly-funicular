# Commerce API v1

Base URL: `http://127.0.0.1:8787/api`. All requests/responses use JSON. Authentication is `Authorization: Bearer <session or scoped agent token>`. Errors: `{error: string, code: string}` with meaningful HTTP status. Session tokens are returned only by register/login. User: `{id,name,email,role:"customer"|"admin"|"driver",createdAt}`. Configure `COMMERCE_DB`, `HOST`, `PORT`, and optionally `ADMIN_EMAIL` + `ADMIN_PASSWORD` for private first-admin bootstrap. Public registration never grants elevated roles. Default currency JOD is configurable. The default CORS allowlist includes the exact dashboard origins `https://amer-ai-store.github.io` and `https://amer-ai-command-center.eagerlark64.chatgpt.site` for browser requests with `Authorization`; it can be replaced via `CORS_ORIGINS`. Both dashboards still need an HTTPS deployment of this server and a configured API URL.

## Customer

- `GET /health` → `{ok,service:"luqta-commerce",currency,facebookConfigured}`.
- `POST /auth/register {name,email,password}` → `{token,user,recoveryCode}`; `/auth/login {email,password}` → `{token,user}`. Password minimum 10 characters. The high-entropy recovery code is shown once to the owner; only its hash is stored. Save it outside the app. No email/SMS delivery or identity verification is configured.
- `POST /auth/recovery-code {password}` (authenticated) → `{recoveryCode}` rotates the one-time code after password confirmation. `POST /auth/recover {email,recoveryCode,newPassword}` consumes it and revokes every previous session. Attempts are rate-limited. Existing accounts can create a code while signed in.
- `GET /auth/me` → `{user}`; `PATCH /auth/me {name}` → `{user}`; `POST /auth/logout` → `{ok:true}`. `DELETE /auth/me {password,confirm:"حذف حسابي"}` revokes access and removes personal data while retaining anonymized financial records; active orders/deliveries/returns, nonzero wallet balance and the last admin block deletion.
- `GET /settings` → `{settings:{storeName,currency,country,shippingFee,freeShippingThreshold,returnsDays}}`.
- `GET /products` → `{products:[{id,name,price,stock,active,category,description,tags,...}]}`; `GET /products/:id` → `{product}`. Active catalog only; `?q=&category=&minPrice=&maxPrice=&sort=price-asc|price-desc|rating` supported.
- `GET /addresses` → `{addresses}`; `POST /addresses {name,phone,city,street,latitude?,longitude?,label?,isDefault?}` → `{address}`; `PATCH /addresses/:id` and `DELETE /addresses/:id`.
- `POST /coupons/validate {code,items:[{productId,quantity}]}` → `{code,discount,subtotal,currency}`.
- `GET /orders` → `{orders}`; `POST /orders {items:[{productId,quantity}],address:{name,phone,city,street,latitude?,longitude?},paymentMethod:"cod"|"wallet",couponCode?,idempotencyKey}` → `{order}`. `idempotencyKey` required. Prices/discount/shipping/stock are calculated and committed by server. Order `{id,userId,date,status,paymentMethod,paymentStatus,items:[{productId,name,price,quantity}],subtotal,discount,shipping,total,currency,address,driverId?,tracking?,events}`.
- `GET /orders/:id` → `{order}`; `POST /orders/:id/cancel` restores stock and refunds an internal-wallet payment exactly once. Only pending/confirmed orders are cancellable.
- `POST /orders/:id/returns {reason}` → `{returnRequest}`; `GET /returns` → `{returns}`. Delivered orders inside returns window only.
- `GET /orders/:id/tracking` → `{orderId,status,driver:{id,name}|null,location:{latitude,longitude,accuracy,updatedAt}|null,destination:{latitude,longitude}|null,events}`. Only owner/assigned driver/admin may read. Driver location is never fabricated.
- `GET /wallet` → `{balance,currency,transactions:[{id,amount,type,note,orderId?,date}]}`. No client top-up endpoint and no fake payment provider. Credit is an auditable admin adjustment or actual internal refund.
- `GET /rewards` → `{points,redeemablePoints,currency,transactions}`. Delivery earns one point per whole currency unit of merchandise after discounts. `POST /rewards/redeem {points,requestKey}` atomically exchanges multiples of 100 points for one currency unit per 100 points in the internal wallet and is idempotent. Approved returns reverse earned points and offset already redeemed value from the refund once.
- `GET /notifications` → `{notifications:[{id,title,body,read,createdAt,orderId?}]}`; `PATCH /notifications/:id {read:true}`; `POST /notifications/read-all`.
- `GET /products/:id/reviews` → `{reviews:[{id,userId,name,rating,title,body,createdAt}],rating,count}`; `POST ... {rating,title?,body}` requires a delivered purchase and one review/product/customer. `PATCH /reviews/:id` updates own review.
- `GET /wishlist` → `{productIds}`; `PUT /wishlist {productIds:[...]}` syncs account wishlist.
- `GET /auth/facebook/status` → `{configured,linked,profile?}`. `POST /auth/facebook/start {redirectUri?}` (authenticated) → `{url}` only when server Meta app credentials/callback are configured. Facebook callback links that authenticated user's account using single-use expiring state; the profile URL alone cannot grant permissions. `DELETE /auth/facebook` disconnects.

## Admin

- `GET /admin/overview` → `{stats:{products,lowStock,orders,customers,revenue,pendingOrders},recentOrders,lowStockProducts}`.
- `GET /admin/products` → `{products}`; `POST /admin/products` and `PATCH /admin/products/:id` → `{product}`; `DELETE /admin/products/:id` archives rather than erasing order history. Optional `oldPrice` is a numeric pre-discount price at least as large as `price`; send `null` to clear it.
- `POST /admin/inventory/import {items:[{id?,sku?,name?,price?,stock|quantity,category?,description?}],mode:"replace"|"add"}` or `{csv,mode}` → `{imported,created,updated,products}`. Import validates all rows before transaction; missing IDs derive from SKU. `mode` defaults replace.
- `GET /admin/inventory/undo` → `{undo:{id,count,mode,createdAt}|null}`; `POST /admin/inventory/undo {importId}` restores the latest import only when no purchase, product edit, review or favorite would make the reversal unsafe.
- `GET /admin/inventory/connector` → `{connector:{url,tokenConfigured,lastSyncAt?,lastResult?}}`; `PUT ... {url,token?}` → safe connector; `POST /admin/inventory/sync` imports configured HTTPS JSON endpoint's `{items}` or `{products}`. Network/private/link-local destinations are rejected, redirects disallowed. Credentials never returned.
- `GET /admin/orders` → `{orders}`; `PATCH /admin/orders/:id {status?,driverId?}` → `{order}`. Status progression `pending → confirmed → preparing → out_for_delivery → delivered` or allowed cancellation, with ledger/stock protection.
- `GET /admin/users` → `{users}`; `PATCH /admin/users/:id {role}` → `{user}`. Cannot demote final admin.
- `GET /admin/coupons` → `{coupons}`; `POST /admin/coupons {code,type:"percent"|"fixed",value,minSubtotal?,maxUses?,expiresAt?,active?}`; `PATCH /admin/coupons/:id`; `DELETE /admin/coupons/:id` deactivates.
- `POST /admin/wallet/adjust {userId,amount,note}` → `{balance,transaction}`. Positive/negative adjustment; cannot overdraw.
- `GET /admin/returns` → `{returns}`; `PATCH /admin/returns/:id {status:"approved"|"rejected",note?}`. Approval restores stock and credits internal wallet once (COD cash settlement remains external).
- `GET /admin/settings` → `{settings}`; `PATCH /admin/settings {storeName?,currency?,country?,shippingFee?,freeShippingThreshold?,returnsDays?}`.
- `GET /admin/audit` → `{events:[{id,actorId,action,entityId,detail,createdAt}]}`.
- `GET /admin/agent-keys` → `{keys}`; `POST /admin/agent-keys {name,scopes:["catalog:write"|"inventory:write"|"orders:write"|"settings:write"|"jobs:write"],expiresAt?}` → `{key,token}` (secret returned once); `DELETE /admin/agent-keys/:id` revokes. All agent mutations audited; no arbitrary shell/code execution.
- `GET/POST /admin/agent-jobs` (`POST {title,description,type:"repair"|"development"|"audit"}`) → `{jobs}` / `{job}`. Jobs are maintenance requests, not claims that source was changed. Scoped agents can `PATCH /agent/jobs/:id {status:"running"|"completed"|"failed",result?,testEvidence?}`; completion requires nonempty test evidence. External central agents must connect and perform actual development themselves.

## Agent + driver

- `GET /agent/capabilities` → documented allowed scopes/operations. Agent tokens can call matching `/admin/products`, `/admin/inventory/*`, `/admin/orders`, `/admin/settings`, `/admin/agent-jobs`; cannot mint new keys, change users, read customer-wide data outside order operation, or access arbitrary shell.
- `GET /driver/orders` → `{orders}` assigned to signed-in driver. `POST /driver/orders/:id/location {latitude,longitude,accuracy?}` → `{location}`. `PATCH /driver/orders/:id {status:"out_for_delivery"|"delivered"}` → `{order}`.

SQLite persistence and a local encryption key are stored in ignored `server/data/`. HTTP tests use a real ephemeral server + temporary SQLite database. External Meta consent, external stock system connectivity, GPS hardware and production server reachability require their actual configured providers and remain explicitly unverified until tested with them.
