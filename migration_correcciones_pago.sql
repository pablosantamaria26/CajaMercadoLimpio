-- Correcciones del medio de pago desde «Ver rendición completa» (15/11/2026).
-- Se guarda el valor anterior y el nuevo, el motivo, quién y cuándo. La rendición original (rendiciones_reparto.detalle_clientes)
-- NO se modifica: las correcciones se aplican al leerla. Solo la clave de servicio (Worker) escribe y lee: sin políticas para anon.
create table if not exists rendicion_pago_correcciones (
  id            bigserial primary key,
  rendicion_id  bigint not null,
  fecha         text,
  turno         text,
  repartidor    text,
  num_cliente   text not null,
  linea         text not null default 'habituales',
  antes         jsonb not null,
  despues       jsonb not null,
  motivo        text not null check (length(trim(motivo)) >= 3),
  quien         text not null,
  creado        timestamptz not null default now(),
  client_op_id  text unique
);
create index if not exists idx_rend_pago_corr_rendicion on rendicion_pago_correcciones (rendicion_id, creado);
alter table rendicion_pago_correcciones enable row level security;
revoke all on rendicion_pago_correcciones from anon, authenticated;
