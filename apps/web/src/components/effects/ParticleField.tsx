"use client";

import { useEffect, useMemo, useState } from "react";
import Particles, { initParticlesEngine } from "@tsparticles/react";
import { loadSlim } from "@tsparticles/slim";
import type { ISourceOptions } from "@tsparticles/engine";

interface ParticleFieldProps {
  className?: string;
  variant?: "fog" | "dust" | "sparks";
  color?: string;
  opacity?: number;
}

export default function ParticleField({
  className = "",
  variant = "fog",
  color = "#ffffff",
  opacity = 0.3,
}: ParticleFieldProps) {
  const [init, setInit] = useState(false);

  useEffect(() => {
    initParticlesEngine(async (engine) => {
      await loadSlim(engine);
    }).then(() => {
      setInit(true);
    });
  }, []);

  const options: ISourceOptions = useMemo(() => {
    const baseOptions: ISourceOptions = {
      fullScreen: false,
      fpsLimit: 60,
      detectRetina: true,
      background: {
        color: "transparent",
      },
    };

    switch (variant) {
      case "fog":
        return {
          ...baseOptions,
          particles: {
            number: {
              value: 50,
              density: {
                enable: true,
              },
            },
            color: {
              value: color,
            },
            opacity: {
              value: { min: 0.05, max: opacity },
              animation: {
                enable: true,
                speed: 0.3,
                sync: false,
              },
            },
            size: {
              value: { min: 100, max: 300 },
              animation: {
                enable: true,
                speed: 2,
                sync: false,
              },
            },
            move: {
              enable: true,
              speed: 0.5,
              direction: "none" as const,
              random: true,
              straight: false,
              outModes: {
                default: "out" as const,
              },
            },
            shape: {
              type: "circle",
            },
          },
        };

      case "dust":
        return {
          ...baseOptions,
          particles: {
            number: {
              value: 80,
              density: {
                enable: true,
              },
            },
            color: {
              value: color,
            },
            opacity: {
              value: { min: 0.1, max: opacity },
              animation: {
                enable: true,
                speed: 0.5,
                sync: false,
              },
            },
            size: {
              value: { min: 1, max: 3 },
            },
            move: {
              enable: true,
              speed: { min: 0.2, max: 1 },
              direction: "none" as const,
              random: true,
              straight: false,
              outModes: {
                default: "out" as const,
              },
            },
            shape: {
              type: "circle",
            },
            twinkle: {
              particles: {
                enable: true,
                frequency: 0.05,
                opacity: 1,
              },
            },
          },
        };

      case "sparks":
        return {
          ...baseOptions,
          particles: {
            number: {
              value: 30,
              density: {
                enable: true,
              },
            },
            color: {
              value: [color, "#ffffff"],
            },
            opacity: {
              value: { min: 0.3, max: opacity },
              animation: {
                enable: true,
                speed: 1,
                sync: false,
              },
            },
            size: {
              value: { min: 1, max: 4 },
              animation: {
                enable: true,
                speed: 3,
                sync: false,
              },
            },
            move: {
              enable: true,
              speed: { min: 1, max: 3 },
              direction: "top" as const,
              random: true,
              straight: false,
              outModes: {
                default: "out" as const,
              },
              gravity: {
                enable: true,
                acceleration: -0.5,
              },
            },
            shape: {
              type: "circle",
            },
            life: {
              duration: {
                sync: false,
                value: { min: 1, max: 3 },
              },
              count: 1,
            },
          },
          emitters: {
            direction: "top" as const,
            position: {
              x: 50,
              y: 100,
            },
            rate: {
              delay: 0.1,
              quantity: 2,
            },
            size: {
              width: 100,
              height: 0,
            },
          },
        };

      default:
        return baseOptions;
    }
  }, [variant, color, opacity]);

  if (!init) {
    return null;
  }

  return (
    <Particles
      className={`absolute inset-0 ${className}`}
      id={`particles-${variant}-${color.replace("#", "")}`}
      options={options}
    />
  );
}
