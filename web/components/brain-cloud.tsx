"use client";

import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { regionColor, regionHue } from "@/lib/palette";
import type { CloudData, CloudPoint } from "@/lib/surface-types";

export type Hover = { point: CloudPoint; x: number; y: number } | null;

/** The visible brain, honest to the vectors: every dot a remembered
 * moment in its true PCA space. Glow is meaning only: fresh memories
 * land as embers and cool, the current percept breathes, search hits
 * ignite. Full mode adds hands (orbit), names (anchors), and time
 * (the replay drawRange). */
export function BrainCloud({
  data,
  variant,
  highlight,
  visibleCount,
  onHover,
  onSelect,
}: {
  data: CloudData | null;
  variant: "tile" | "full";
  highlight: ReadonlySet<string>;
  visibleCount?: number;
  onHover?: (hover: Hover) => void;
  onSelect?: (point: CloudPoint) => void;
}) {
  return (
    <div className="h-full w-full" aria-hidden={variant === "tile"}>
      <Canvas camera={{ position: [0, 0, 2.6], fov: 50 }} gl={{ antialias: true, alpha: true }}>
        {variant === "full" && (
          <>
            <OrbitControls enablePan={false} enableZoom={false} dampingFactor={0.08} />
            <PinchZoom />
          </>
        )}
        {data && data.points.length > 0 && (
          <Points
            data={data}
            variant={variant}
            highlight={highlight}
            visibleCount={visibleCount ?? data.points.length}
            onHover={onHover}
            onSelect={onSelect}
          />
        )}
      </Canvas>
    </div>
  );
}

function Points({
  data,
  variant,
  highlight,
  visibleCount,
  onHover,
  onSelect,
}: {
  data: CloudData;
  variant: "tile" | "full";
  highlight: ReadonlySet<string>;
  visibleCount: number;
  onHover?: (hover: Hover) => void;
  onSelect?: (point: CloudPoint) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const pulse = useRef<THREE.Mesh>(null);
  const raycaster = useThree((state) => state.raycaster);
  const dark = useMemo(
    () => typeof window !== "undefined" && document.documentElement.classList.contains("dark"),
    [],
  );

  useEffect(() => {
    raycaster.params.Points.threshold = 0.03;
  }, [raycaster]);

  const scale = useMemo(() => fitScale(data.points), [data]);

  const { geometry, latestPosition } = useMemo(() => {
    const now = Date.now();
    const positions = new Float32Array(data.points.length * 3);
    const colors = new Float32Array(data.points.length * 3);
    const color = new THREE.Color();
    const ember = new THREE.Color(dark ? "#ffb296" : "#e8674a");
    const searching = highlight.size > 0;
    let latest: THREE.Vector3 | null = null;

    data.points.forEach((point, index) => {
      const [x, y, z] = point.p;
      positions[index * 3] = x * scale;
      positions[index * 3 + 1] = y * scale;
      positions[index * 3 + 2] = z * scale;

      const hit = searching && highlight.has(point.id);
      const base = dark ? (point.keyframe ? 0.72 : 0.55) : point.keyframe ? 0.42 : 0.3;
      if (hit) {
        color.setHSL(regionHue(point.region) / 360, 0.9, dark ? 0.92 : 0.48);
      } else {
        color.setHSL(
          regionHue(point.region) / 360,
          searching ? 0.25 : 0.72,
          searching ? base * (dark ? 0.3 : 1.7) : base,
        );
        // Fresh memories land hot and cool into their region hue.
        const age = (now - Date.parse(`${point.ts.replace(" ", "T")}Z`)) / 1000;
        if (age < 12 && !searching) color.lerp(ember, Math.max(0, 1 - age / 12));
      }
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
      if (point.id === data.latest) {
        latest = new THREE.Vector3(x * scale, y * scale, z * scale);
      }
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return { geometry, latestPosition: latest as THREE.Vector3 | null };
  }, [data, dark, highlight, scale]);

  useEffect(() => {
    geometry.setDrawRange(0, visibleCount);
  }, [geometry, visibleCount]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (group.current && variant === "tile") {
      group.current.rotation.y = t * 0.05;
      group.current.rotation.x = Math.sin(t * 0.11) * 0.08;
    }
    if (pulse.current) {
      const beat = 1 + Math.sin(t * 2.4) * 0.35;
      pulse.current.scale.setScalar(beat);
      (pulse.current.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(t * 2.4) * 0.3;
    }
  });

  const interactive = variant === "full" && (onHover || onSelect);

  return (
    <group ref={group}>
      <points
        geometry={geometry}
        onPointerMove={
          interactive
            ? (event) => {
                event.stopPropagation();
                const index = event.index;
                if (index === undefined || index >= visibleCount) return onHover?.(null);
                const native = event.nativeEvent as PointerEvent;
                onHover?.({ point: data.points[index], x: native.clientX, y: native.clientY });
              }
            : undefined
        }
        onPointerOut={interactive ? () => onHover?.(null) : undefined}
        onClick={
          interactive
            ? (event) => {
                event.stopPropagation();
                const index = event.index;
                if (index !== undefined && index < visibleCount) onSelect?.(data.points[index]);
              }
            : undefined
        }
      >
        <pointsMaterial
          size={variant === "full" ? 0.034 : 0.028}
          map={dotSprite()}
          alphaTest={0.01}
          vertexColors
          transparent
          opacity={0.92}
          sizeAttenuation
          depthWrite={false}
          blending={dark ? THREE.AdditiveBlending : THREE.NormalBlending}
        />
      </points>

      {latestPosition && (
        <mesh ref={pulse} position={latestPosition}>
          <sphereGeometry args={[0.04, 16, 16]} />
          <meshBasicMaterial color={dark ? "#ffffff" : "#e8674a"} transparent opacity={0.7} depthWrite={false} />
        </mesh>
      )}

      {variant === "full" &&
        data.anchors.map((anchor) => (
          <Html
            key={anchor.region}
            position={[anchor.p[0] * scale, anchor.p[1] * scale, anchor.p[2] * scale]}
            center
            style={{ pointerEvents: "none" }}
          >
            <span
              className="label whitespace-nowrap"
              style={{ color: regionColor(anchor.region, dark ? 70 : 40), textShadow: "0 1px 8px rgba(0,0,0,.7)" }}
            >
              {anchor.label}
            </span>
          </Html>
        ))}
    </group>
  );
}

/** Trackpad-native depth: pinch out dives in, pinch in pulls back
 * (pinches arrive as ctrlKey wheels); plain scrolling does nothing. */
function PinchZoom() {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    const el = gl.domElement;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!event.ctrlKey) return;
      const distance = camera.position.length() * (1 + event.deltaY * 0.012);
      camera.position.setLength(Math.min(5, Math.max(1.2, distance)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [camera, gl]);
  return null;
}

let sprite: THREE.Texture | null = null;

/** Soft radial dot; raw gl points draw as hard squares. */
function dotSprite(): THREE.Texture {
  if (sprite) return sprite;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.4, "rgba(255,255,255,0.8)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  sprite = new THREE.CanvasTexture(canvas);
  return sprite;
}

/** Fits the PCA extent into view without lying about relative distances. */
function fitScale(points: CloudPoint[]): number {
  let max = 0.001;
  for (const point of points) {
    for (const value of point.p) max = Math.max(max, Math.abs(value));
  }
  return 1.15 / max;
}
