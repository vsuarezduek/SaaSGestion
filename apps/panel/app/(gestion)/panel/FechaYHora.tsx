'use client';
// Fecha del día y hora de Argentina en el Inicio; la hora se actualiza sola cada 15 segundos.
import { useEffect, useState } from 'react';

const TZ = 'America/Argentina/Buenos_Aires';

export function formatearFechaYHora(d: Date): { fecha: string; hora: string } {
  const f = d.toLocaleDateString('es-AR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const hora = d.toLocaleTimeString('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  return { fecha: f.charAt(0).toUpperCase() + f.slice(1), hora };
}

export default function FechaYHora({ inicial }: { inicial: string }) {
  const [ahora, setAhora] = useState(() => new Date(inicial));
  useEffect(() => {
    setAhora(new Date());
    const t = setInterval(() => setAhora(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  const { fecha, hora } = formatearFechaYHora(ahora);
  return (
    <h2 style={{ fontFamily: 'Georgia, serif', margin: '0 0 8px', fontSize: 22 }} suppressHydrationWarning>
      {fecha} · {hora} h
    </h2>
  );
}
