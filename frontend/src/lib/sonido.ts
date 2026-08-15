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

/**
 * I22: el aviso suena SOLO en los tres hitos del pedido — creado (ABIERTO),
 * alistado y aprobado. Pendiente de corrección y cancelado quedan en
 * silencio, y una lista que "re-aparece" tras cambiar de pestaña no suena
 * (los estados se siembran globalmente y la primera vista de un pedido ya
 * existente no es un evento).
 */
const TONO_POR_ESTADO: Record<string, number> = {
  ABIERTO: 523, // do — pedido creado
  ALISTADO: 659, // mi — pedido alistado
  APROBADO: 784, // sol — pedido aprobado
};

function avisarHitoPedido(estado: string) {
  const tono = TONO_POR_ESTADO[estado];
  if (tono) campanada(tono);
}

/** Estados conocidos en toda la app (sobrevive a cambios de lista/pestaña). */
const estadosConocidos = new Map<string, string>();
let sembradoGlobal = false;

/**
 * Hook: observa una lista de pedidos y emite el aviso cuando alguno ENTRA a
 * ABIERTO/ALISTADO/APROBADO por primera vez o cambia entre esos hitos.
 */
export function useAvisoEstadosPedidos(
  pedidos: { id: string; estado: string }[],
) {
  const primeraLista = useRef(true);

  useEffect(() => {
    prepararConGesto();
  }, []);

  useEffect(() => {
    for (const p of pedidos) {
      const anterior = estadosConocidos.get(p.id);
      if (anterior === undefined) {
        // Pedido no visto antes: solo suena como "nuevo" si la app ya había
        // sembrado su primera lista (si no, es carga inicial → silencio)
        if (sembradoGlobal && !primeraLista.current) avisarHitoPedido(p.estado);
      } else if (anterior !== p.estado) {
        avisarHitoPedido(p.estado);
      }
      estadosConocidos.set(p.id, p.estado);
    }
    primeraLista.current = false;
    sembradoGlobal = true;
  }, [pedidos]);
}
