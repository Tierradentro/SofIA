'use client';

import { useEffect, useRef } from 'react';

/**
 * I21: aviso sonoro cuando un pedido cambia de estado (excepto CANCELADO).
 * WebAudio puro — sin archivos de audio ni dependencias.
 *
 * El navegador exige un gesto del usuario antes de permitir audio: el
 * contexto se crea/reanuda en el primer clic o tecla de la sesión.
 */

let ctx: AudioContext | null = null;
let gestoRegistrado = false;

function contexto(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Registra (una vez) el gesto que habilita el audio del navegador. */
function prepararConGesto() {
  if (gestoRegistrado || typeof window === 'undefined') return;
  gestoRegistrado = true;
  const habilitar = () => contexto();
  window.addEventListener('pointerdown', habilitar, { once: true });
  window.addEventListener('keydown', habilitar, { once: true });
}

/** Tono corto: dos notas sucesivas (campanada suave). */
function campanada(frecuencia: number) {
  const audio = contexto();
  if (!audio) return;
  const t0 = audio.currentTime;
  for (const [nota, inicio] of [
    [frecuencia, 0],
    [frecuencia * 1.5, 0.16],
  ] as const) {
    const osc = audio.createOscillator();
    const ganancia = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = nota;
    ganancia.gain.setValueAtTime(0.0001, t0 + inicio);
    ganancia.gain.exponentialRampToValueAtTime(0.22, t0 + inicio + 0.02);
    ganancia.gain.exponentialRampToValueAtTime(0.0001, t0 + inicio + 0.5);
    osc.connect(ganancia).connect(audio.destination);
    osc.start(t0 + inicio);
    osc.stop(t0 + inicio + 0.55);
  }
}

/** Frecuencia por estado destino: cada transición suena distinto. */
const TONO_POR_ESTADO: Record<string, number> = {
  ABIERTO: 523, // do
  ALISTADO: 659, // mi
  APROBADO: 784, // sol
  PENDIENTE_CORRECCION: 392, // sol grave (alerta)
};

/** Avisa el cambio de estado de un pedido. CANCELADO queda en silencio. */
export function avisarEstadoPedido(estado: string) {
  if (estado === 'CANCELADO') return;
  const tono = TONO_POR_ESTADO[estado] ?? 587;
  campanada(tono);
}

/**
 * Hook: observa una lista de pedidos y emite el aviso cuando alguno cambia
 * de estado entre sondeos. La primera carga no suena (solo siembra).
 */
export function useAvisoEstadosPedidos(
  pedidos: { id: string; estado: string }[],
) {
  const previos = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    prepararConGesto();
  }, []);

  useEffect(() => {
    const actuales = new Map(pedidos.map((p) => [p.id, p.estado]));
    const antes = previos.current;
    if (antes !== null) {
      actuales.forEach((estado, id) => {
        const anterior = antes.get(id);
        // Suena al cambiar de estado; también cuando aparece un pedido nuevo
        if (anterior !== estado) avisarEstadoPedido(estado);
      });
    }
    previos.current = actuales;
  }, [pedidos]);
}
