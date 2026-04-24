// FILTERS & VIEWS: view mode, activeFilters, country picker, geocoding, near-me
// Extracted from index.html


// ─── PUBLIC RENDER ────────────────────────────────────
let activeFilters=new Set(['mobile','club']);
let searchTerm='';
let sortMode='name';
let userLocation=null;
let viewMode='grid';

function setViewMode(mode) {
  viewMode = mode;
  document.getElementById('btn-grid').classList.toggle('active', mode === 'grid');
  document.getElementById('btn-list').classList.toggle('active', mode === 'list');
  const grid = document.getElementById('dj-grid');
  grid.classList.toggle('list-mode', mode === 'list');
  grid.classList.add('no-animate');
  renderPublic(false);
  setTimeout(() => grid.classList.remove('no-animate'), 50);
}

// Haversine distance formula
function calcDistance(lat1,lon1,lat2,lon2){
  const R=3959; // miles
  const dLat=(lat2-lat1)*Math.PI/180;
  const dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2);
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

// Country code map for geocoding bias
const COUNTRY_CODES = {'United States':'us','United Kingdom':'gb','Canada':'ca','Australia':'au','Germany':'de','France':'fr','Netherlands':'nl','Spain':'es','Italy':'it','Brazil':'br','Mexico':'mx','Japan':'jp','South Africa':'za','New Zealand':'nz','Ireland':'ie','Sweden':'se','Norway':'no','Denmark':'dk','Belgium':'be','Switzerland':'ch','Portugal':'pt'};

// Geocode city name or zip to lat/lng
async function geocodeCity(query, countryCode){
  if(!query)return null;
  try{
    const isZip = /^\d{4,10}$/.test(query.trim());
    const cc = countryCode || COUNTRY_CODES[activeCountry] || '';
    const url = isZip
      ? `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(query)}${cc?'&countrycodes='+cc:''}&format=json&limit=1`
      : `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}${cc?'&countrycodes='+cc:''}&format=json&limit=1`;
    const res=await fetch(url);
    const data=await res.json();
    if(data&&data[0])return{lat:parseFloat(data[0].lat),lng:parseFloat(data[0].lon)};
  }catch(e){console.error('Geocode error:',e);}
  return null;
}

function findNearMe(){
  const btn=document.getElementById('near-me-btn');
  if(!navigator.geolocation){alert('Geolocation not supported by your browser');return;}
  btn.textContent='Getting location...';
  btn.disabled=true;
  navigator.geolocation.getCurrentPosition(
    pos=>{
      userLocation={lat:pos.coords.latitude,lng:pos.coords.longitude};
      sortMode='nearest';
      btn.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg> Near Me ✓`;
      btn.disabled=false;
      renderPublic();
    },
    err=>{
      alert('Could not get your location. Please search by zip code instead.');
      btn.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg> Find DJs Near Me`;
      btn.disabled=false;
    }
  );
}

// Country flags map
const COUNTRY_FLAGS = {
  'United States': '🇺🇸',
  'United Kingdom': '🇬🇧',
  'Canada': '🇨🇦',
  'Australia': '🇦🇺',
  'Germany': '🇩🇪',
  'France': '🇫🇷',
  'Netherlands': '🇳🇱',
  'Spain': '🇪🇸',
  'Italy': '🇮🇹',
  'Brazil': '🇧🇷',
  'Mexico': '🇲🇽',
  'Japan': '🇯🇵',
  'South Africa': '🇿🇦',
  'New Zealand': '🇳🇿',
  'Ireland': '🇮🇪',
  'Sweden': '🇸🇪',
  'Norway': '🇳🇴',
  'Denmark': '🇩🇰',
  'Belgium': '🇧🇪',
  'Switzerland': '🇨🇭',
  'Portugal': '🇵🇹',
  'Other': '🌍',
};
const COUNTRY_NAMES = Object.keys(COUNTRY_FLAGS);

// Determine active country — logged in user's country or default US
let activeCountry = 'United States';
if (typeof GDJAuth !== 'undefined' && GDJAuth.ready) {
  GDJAuth.ready((cu) => {
    if (cu && cu.country) activeCountry = cu.country;
    updateCountryFlag();
  });
} else {
  // GDJAuth not available — just leave default and update flag
  setTimeout(() => { try { updateCountryFlag(); } catch(e) {} }, 0);
}

function updateCountryFlag() {
  const flag = COUNTRY_FLAGS[activeCountry] || '🌍';
  document.getElementById('country-flag').textContent = flag;
}

function buildCountryMenu() {
  const menu = document.getElementById('country-menu');
  menu.innerHTML = COUNTRY_NAMES.map(c => `
    <div class="country-option ${c === activeCountry ? 'selected' : ''}" onclick="selectCountry(event, '${c}')">
      <span>${COUNTRY_FLAGS[c]}</span><span>${c}</span>
    </div>
  `).join('');
}

function toggleCountryMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('country-menu');
  if (menu.style.display === 'none') {
    buildCountryMenu();
    menu.style.display = 'block';
  } else {
    menu.style.display = 'none';
  }
}

function selectCountry(e, country) {
  e.stopPropagation();
  activeCountry = country;
  updateCountryFlag();
  document.getElementById('country-menu').style.display = 'none';
  renderPublic();
}

// Close menu when clicking outside
document.addEventListener('click', () => {
  const menu = document.getElementById('country-menu');
  if (menu) menu.style.display = 'none';
});

