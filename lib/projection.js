// Même projection que lib/visits/projection.ts du site :
// azimutale équidistante, pôle Nord au centre, 0° en bas, est à droite.
const MAP_SIZE = 760;
const MAP_CENTER = MAP_SIZE / 2;
const MAP_RADIUS = 300;                 // rayon jusqu'au cercle de glace (lat -90)
const MAP_CLIP = MAP_RADIUS * 0.86;     // disque visible

function projectCity(longitude, latitude) {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  const rho = Math.PI / 2 - (latitude * Math.PI) / 180;
  const lambda = (longitude * Math.PI) / 180;
  const k = MAP_RADIUS / Math.PI;
  const x = MAP_CENTER + k * rho * Math.sin(lambda);
  const y = MAP_CENTER + k * rho * Math.cos(lambda);
  const dx = x - MAP_CENTER;
  const dy = y - MAP_CENTER;
  if (dx * dx + dy * dy > MAP_CLIP * MAP_CLIP) return null;
  return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
}

module.exports = { MAP_SIZE, MAP_CENTER, MAP_RADIUS, MAP_CLIP, projectCity };
