# TOROGOLDESCANERINTELIGENTE

Escáner móvil OCR de referencias para TORO GOLD, con consulta automática de solo lectura a Effi.

## Despliegue Cloudflare Workers
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Root: `/`
- Agregar el secreto **EFFI_API_KEY** en Cloudflare Workers > Settings > Variables and Secrets (tipo Secret). Nunca publicarlo en GitHub.
- La cámara requiere HTTPS y permiso del usuario.
- Si Cloudflare Pages está configurado en lugar de Workers, migrar a Workers porque la ruta `/api/articulo` se sirve mediante `worker/index.js`.

## Desarrollo
`npm install`, `npm run build`, `npx wrangler dev`.
El navegador realiza OCR con Tesseract.js. Tras dos lecturas consecutivas de la misma referencia consulta `GET /api/articulo?referencia=...`; el Worker realiza la petición autenticada a Effi y devuelve solamente datos de producto necesarios para la pantalla.

## Estado
Primera versión de prueba: pendiente configurar el secreto, desplegar y validar OCR con etiquetas reales de BarTender. No incluye autenticación de asesores; **no habilitar acceso público a tarifas mayoristas** antes de incorporar control de acceso. No se han probado consultas con credenciales reales.
