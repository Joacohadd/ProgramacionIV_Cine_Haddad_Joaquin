-- Datos ficticios equivalentes a la muestra local. Ejecutar tras schema.sql si
-- se desea probar el sitio conectado sin cargar películas a mano.
insert into public.peliculas (id, titulo, sinopsis, duracion_minutos, imagen_url, generos, clasificacion, visible_inicio, fecha_estreno) values
('10000000-0000-4000-8000-000000000001','La última luz','En una ciudad que apaga sus luces cada noche, una archivista descubre la única ventana que permanece encendida.',114,'/posters/ultima-luz.svg',array['Drama','Misterio'],'13',true,'2026-09-01'),
('10000000-0000-4000-8000-000000000002','Mareas de vidrio','Un viaje de regreso a la costa se convierte en una búsqueda de aquello que la memoria decidió esconder.',102,'/posters/mareas.svg',array['Drama','Romance'],'ATP',true,'2026-08-28'),
('10000000-0000-4000-8000-000000000003','Órbita cero','Cuando una nave pierde contacto con la Tierra, su tripulación descubre que la señal nunca llegó a salir.',127,'/posters/orbita.svg',array['Ciencia ficción','Suspenso'],'13',true,'2026-09-05'),
('10000000-0000-4000-8000-000000000004','El jardín nocturno','La botánica de un pueblo remoto encuentra un jardín que florece solamente mientras todos duermen.',96,'/posters/jardin.svg',array['Fantasía','Aventura'],'ATP',true,'2026-09-10'),
('10000000-0000-4000-8000-000000000005','El ruido del agua','Una periodista regresa a su isla natal para investigar un sonido imposible que aparece cada madrugada.',108,'/posters/agua.svg',array['Misterio','Suspenso'],'18',true,'2026-09-08'),
('10000000-0000-4000-8000-000000000006','Otra forma de volver','Un padre y una hija atraviesan la ruta más larga del país y descubren que ninguna despedida fue definitiva.',89,'/posters/volver.svg',array['Drama','Aventura'],'ATP',true,'2026-09-12')
on conflict (id) do nothing;

-- El modo conectado empieza con 0 ventas. Solo entradas realmente pagadas
-- (insertadas por un checkout posterior) afectan el orden del top 3.
-- Las reseñas se publican desde la aplicación con una cuenta autenticada, para
-- conservar el vínculo entre cada opinión y su perfil de Supabase.

-- Salas y programación de muestra para el punto 4.4. Volver a ejecutar este
-- archivo después de la migración de funciones es seguro: los UUID no se repiten.
insert into public.salas (id, nombre, filas, butacas_izquierda, butacas_centro, butacas_derecha, formatos, activa) values
('20000000-0000-4000-8000-000000000001','Sala Horizonte',20,4,20,4,array['2D','3D'],true),
('20000000-0000-4000-8000-000000000002','Sala Prisma',20,4,20,4,array['2D','3D','4D'],true),
('20000000-0000-4000-8000-000000000003','Sala Umbral',20,4,20,4,array['2D','5D'],true)
on conflict (id) do nothing;

insert into public.funciones (id, pelicula_id, sala_id, fecha_desde, fecha_hasta, dias_semana, hora_inicio, formato, idioma, activa) values
('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','2026-09-01','2026-10-31',array[1,3,5]::smallint[],'18:00','2D','Castellano',true),
('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002','2026-09-01','2026-10-31',array[1,3,5]::smallint[],'18:00','3D','Subtitulada',true),
('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','2026-09-01','2026-10-31',array[2,4,6]::smallint[],'20:30','2D','Castellano',true),
('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000003','2026-09-01','2026-10-31',array[6,7]::smallint[],'16:00','5D','Castellano',true)
on conflict (id) do nothing;
