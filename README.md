# TP 1 - Programación IV

## Cine Umbral

Aplicación web de un cine desarrollada con Angular, TypeScript, HTML y CSS. La autenticación y la base de datos se realizan con Supabase.

## Avance

### 4.1 Usuarios y perfiles

- Registro con datos personales.
- Inicio y cierre de sesión.
- Perfil de usuario con rol, crédito y puntos.
- Protección de rutas para usuarios y administradores.

### 4.2 Películas, cartelera y búsqueda

- Alta, edición y visibilidad de películas desde administración.
- Cartelera pública con géneros, clasificación y duración.
- Búsqueda por título, sinopsis y género.
- Filtro por género y orden de películas más vendidas.

### 4.3 Reseñas y calificaciones

- Calificación de una a cinco estrellas.
- Comentarios de 5 a 280 caracteres.
- Edición de la reseña propia.
- Promedio y listado de reseñas en el detalle de cada película.

### 4.4 Funciones, salas y programación

- Alta, edición y baja de funciones.
- Rango de fechas, días de la semana, horario, idioma y formato.
- Administración de salas, capacidad, bloques de butacas, formatos y estado.
- Asignación automática de sala compatible.
- Validación de duración, superposiciones y cruces de medianoche.

### 4.5 Butacas y disponibilidad

- Mapa de butacas dividido en tres bloques.
- Selección y reserva temporal con actualización en tiempo real.
- Filas J y K accesibles con distribución 2, 10 y 2.
- Filas R, S y T VIP con precio diferencial.

### 4.6 Compra, entradas y cancelaciones

- Compra de las butacas reservadas para una función.
- Control de edad según clasificación y aviso de acompañamiento adulto.
- Uso total o parcial del crédito junto con otro medio de pago.
- Entrada descargable en PDF con código QR validable por personal autorizado.
- Historial de compras en el perfil.
- Cancelación hasta 2 horas antes con reintegro en crédito.

### 4.7 Candy bar y combos

- Alta y edición de productos con nombre, descripción, precio e imagen opcional.
- Publicación y ocultamiento desde administración.
- Catálogo público con los productos publicados y sus precios.
- Creación de categorías y asignación a cada producto.
- Catálogo agrupado por categoría.
- Productos del candy agregados a la misma compra de entradas.
- Total, pago, comprobante e historial con el detalle conjunto.
- Retiro del pedido con el mismo QR de la entrada y registro de la entrega.
- Alta, edición y publicación de combos de entrada, pochoclos y bebida con precio fijo.
- Combos destacados durante el proceso de compra.

El retiro del candy y el acceso a sala se registran por separado para que una acción no bloquee la otra. Una compra cuyo pedido ya fue entregado no puede cancelarse con reintegro.

### 4.8 Cupones y descuentos

- Cupón configurable para la primera compra de cada usuario registrado.
- Administración del porcentaje y estado del beneficio sin modificar código.
- Alta y edición de cupones exclusivos para usuarios mayores de 50 años.
- Validación de edad y disponibilidad al confirmar la compra.
- Descuento registrado en la compra, el historial y la entrada PDF.

## Ejecutar

```bash
npm install
npm start
```

La aplicación queda disponible en `http://localhost:4200`.

Para preparar Supabase, ejecutar `supabase/schema.sql` y `supabase/seed.sql`. Si la base ya tiene los puntos anteriores, ejecutar las migraciones pendientes en orden hasta `supabase/migrations/20260923_cupones.sql`. La URL y la publishable key se configuran en `src/environments/environment.ts`.

## Verificar

```bash
npm run build
npm test
```
