// Geoman extends the global `L`, so Leaflet has to be on window before Geoman's module runs.
// (A separate module because ES imports are hoisted: this file is evaluated first.)
import L from 'leaflet';

window.L = L;
