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

Los puntos posteriores quedan fuera de esta entrega.

## Ejecutar

```bash
npm install
npm start
```

La aplicación queda disponible en `http://localhost:4200`.

Para preparar Supabase, ejecutar `supabase/schema.sql` y `supabase/seed.sql`. Si la base ya tiene los puntos anteriores, ejecutar también `supabase/migrations/20260915_resenas.sql` y `supabase/migrations/20260916_funciones_salas.sql`. La URL y la publishable key se configuran en `src/environments/environment.ts`.

## Verificar

```bash
npm run build
npm test
```
