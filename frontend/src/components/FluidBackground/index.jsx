import { useEffect } from 'react';

let fluidScriptPromise;

function loadFluidScript() {
  if (!fluidScriptPromise) {
    fluidScriptPromise = import('./webgl-fluid.js');
  }

  return fluidScriptPromise;
}

export function FluidBackground() {
  useEffect(() => {
    let cancelled = false;

    loadFluidScript().catch((error) => {
      if (!cancelled) {
        console.error('Failed to load fluid background:', error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="fluid-background" aria-hidden="true">
      <canvas className="fluid-background__canvas" />
      <div className="fluid-background__veil" />
    </div>
  );
}