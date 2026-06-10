import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import { Bell, MapPin, Navigation, Settings, AlertTriangle, ShieldAlert, Crosshair, Mail, User } from 'lucide-react';
import L from 'leaflet';
import mqtt from 'mqtt';
import { registerPlugin } from '@capacitor/core';
const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');

// Create custom icons
const createIcon = (type) => {
  let colorClass = type === 'me' ? 'active' : type === 'alert' ? 'alert' : '';
  let iconHtml = `
    <div class="custom-marker ${colorClass}">
      <div class="marker-pulse"></div>
      <div class="marker-pin">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="marker-icon"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
      </div>
    </div>
  `;
  return L.divIcon({
    className: 'custom-div-icon',
    html: iconHtml,
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40]
  });
};

const icons = {
  me: createIcon('me'),
  device: createIcon('device'),
  alert: createIcon('alert')
};

// Map Updater Component to center map on selection
function MapUpdater({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.flyTo(center, zoom || map.getZoom());
    }
  }, [center, map, zoom]);
  return null;
}

function App() {
  // Auth State
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });

  // Map & Devices State
  const [myLocation, setMyLocation] = useState(null);
  const [devices, setDevices] = useState([]);
  const [geofence, setGeofence] = useState({ lat: 13.7563, lng: 100.5018, radius: 2000 }); // 2km radius
  const [notifications, setNotifications] = useState([
    { id: 1, type: 'info', title: 'System Started', desc: 'GPS Tracking system initialized.', time: new Date().toLocaleTimeString(), extraClass: '' }
  ]);
  const [selectedDevice, setSelectedDevice] = useState('all');
  const [mapCenter, setMapCenter] = useState([13.7563, 100.5018]);
  
  // Real-time & Background Refs
  const mqttClient = useRef(null);
  const myDeviceId = useRef(localStorage.getItem('deviceId') || ('d_' + Math.random().toString(36).substr(2, 9)));
  const geofenceSet = useRef(false);

  useEffect(() => {
    localStorage.setItem('deviceId', myDeviceId.current);
  }, []);

  const handleLogin = (e) => {
    e.preventDefault();
    if (loginForm.email) {
      setUserEmail(loginForm.email);
      setIsLoggedIn(true);
    }
  };

  // Connect to MQTT for Real-time Device Sync
  useEffect(() => {
    if (!isLoggedIn) return;
    
    // Connect to public MQTT Broker over WebSockets
    const client = mqtt.connect('wss://test.mosquitto.org:8081');
    mqttClient.current = client;

    client.on('connect', () => {
      client.subscribe('gpstracker/ttta/locations');
      addNotification('success', 'Online', 'Connected to real-time network. Other devices will appear here.');
    });

    client.on('message', (topic, message) => {
      if (topic === 'gpstracker/ttta/locations') {
        try {
          const data = JSON.parse(message.toString());
          if (data.id === myDeviceId.current) return; // Skip our own messages
          
          setDevices(prev => {
            const exists = prev.find(d => d.id === data.id);
            
            // Check if device just went outside geofence
            if (exists && exists.status === 'safe' && data.status === 'alert') {
              addNotification('danger', 'Geofence Alert', `${data.name} has left their designated safe zone!`);
              sendEmailAlert(data.name);
            } else if (exists && exists.status === 'alert' && data.status === 'safe') {
              addNotification('success', 'Back to Safety', `${data.name} has re-entered the safe zone.`);
            }

            if (exists) {
              return prev.map(d => d.id === data.id ? { ...d, lat: data.lat, lng: data.lng, status: data.status, name: data.name } : d);
            }
            return [...prev, { id: data.id, name: data.name, lat: data.lat, lng: data.lng, status: data.status }];
          });
        } catch(e) {}
      }
    });

    return () => client.end();
  }, [isLoggedIn]);

  // Distance calculator
  const getDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  const addNotification = (type, title, desc, extraClass = '') => {
    setNotifications(prev => [{
      id: Date.now() + Math.random(),
      type, title, desc, extraClass,
      time: new Date().toLocaleTimeString()
    }, ...prev].slice(0, 20));
  };

  // Simulate Email Sending
  const sendEmailAlert = (deviceName) => {
    console.log(`[EmailJS] Sending Geofence Alert Email for ${deviceName} to ${userEmail}...`);
    // Simulate network delay
    setTimeout(() => {
      addNotification('email', 'Email Sent', `Geofence alert for ${deviceName} was sent to ${userEmail}`, 'email-alert');
    }, 1500);
  };

  // Track Location (Foreground & Background)
  useEffect(() => {
    if (!isLoggedIn) return;

    let bgWatcherId = null;

    const updateLocation = (lat, lng) => {
      setMyLocation([lat, lng]);
      
      // Initialize geofence center to our first location
      setGeofence(prev => {
        if (!geofenceSet.current) {
          geofenceSet.current = true;
          setMapCenter([lat, lng]);
          return { ...prev, lat, lng };
        }
        return prev;
      });

      // Calculate status against current geofence
      const dist = getDistance(geofence.lat, geofence.lng, lat, lng);
      const status = dist > geofence.radius ? 'alert' : 'safe';

      // Publish to other devices
      if (mqttClient.current && mqttClient.current.connected) {
        mqttClient.current.publish('gpstracker/ttta/locations', JSON.stringify({
          id: myDeviceId.current,
          name: userEmail.split('@')[0],
          lat, lng, status
        }));
      }
    };

    // 1. Standard HTML5 Geolocation (Works in Browser while open)
    const fgWatchId = navigator.geolocation.watchPosition(
      (pos) => updateLocation(pos.coords.latitude, pos.coords.longitude),
      (err) => console.error('Foreground GPS Error:', err),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
    );

    // 2. Capacitor Background Geolocation (Works in Native APK even when closed)
    try {
      BackgroundGeolocation.addWatcher(
        {
          backgroundMessage: "Tracking your location in background.",
          backgroundTitle: "GPS Tracker Hub",
          requestPermissions: true,
          stale: false,
          distanceFilter: 10 // Update every 10 meters
        },
        (location, error) => {
          if (error) return console.error('Background GPS Error:', error);
          if (location) updateLocation(location.latitude, location.longitude);
        }
      ).then(id => {
        bgWatcherId = id;
      });
    } catch (e) {
      console.log('Background geolocation plugin is only active on Native Android/iOS builds.');
    }

    return () => {
      navigator.geolocation.clearWatch(fgWatchId);
      if (bgWatcherId) {
        try { BackgroundGeolocation.removeWatcher({ id: bgWatcherId }); } catch(e) {}
      }
    };
  }, [isLoggedIn, geofence]);

  const handleDeviceFocus = (id) => {
    setSelectedDevice(id);
    if (id === 'me' && myLocation) {
      setMapCenter(myLocation);
    } else {
      const dev = devices.find(d => d.id === id);
      if (dev) setMapCenter([dev.lat, dev.lng]);
    }
  };

  const NotificationIcon = ({ type }) => {
    if (type === 'danger') return <ShieldAlert size={20} />;
    if (type === 'warning') return <AlertTriangle size={20} />;
    if (type === 'success') return <Navigation size={20} />;
    if (type === 'email') return <Mail size={20} />;
    return <Bell size={20} />;
  };

  // Render Login Screen
  if (!isLoggedIn) {
    return (
      <div className="login-container">
        <div className="login-bg-shape1"></div>
        <div className="login-bg-shape2"></div>
        <div className="glass-panel login-box">
          <div className="login-header">
            <div className="login-title">Tracker Hub</div>
            <div className="login-desc">Sign in to track your devices</div>
          </div>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="input-group">
              <label>Email Address</label>
              <input 
                type="email" 
                placeholder="you@example.com" 
                required 
                value={loginForm.email}
                onChange={e => setLoginForm({...loginForm, email: e.target.value})}
              />
            </div>
            <div className="input-group">
              <label>Password</label>
              <input 
                type="password" 
                placeholder="••••••••" 
                required
                value={loginForm.password}
                onChange={e => setLoginForm({...loginForm, password: e.target.value})}
              />
            </div>
            <button type="submit" className="btn-primary" style={{ marginTop: '10px' }}>
              Sign In
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Render Main Dashboard
  return (
    <div className="app-container">
      {/* Map Background */}
      <div className="map-container">
        <MapContainer center={mapCenter} zoom={13} style={{ height: '100%', width: '100%' }} zoomControl={false}>
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          <MapUpdater center={mapCenter} />
          
          {/* Geofence */}
          <Circle 
            center={[geofence.lat, geofence.lng]} 
            radius={geofence.radius} 
            pathOptions={{ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.1, weight: 2, dashArray: '5, 5' }} 
          />

          {/* My Location */}
          {myLocation && (
            <Marker position={myLocation} icon={icons.me}>
              <Popup>
                <strong>My Location</strong><br/>You are here.
              </Popup>
            </Marker>
          )}

          {/* Devices */}
          {devices.map(dev => (
            <Marker key={dev.id} position={[dev.lat, dev.lng]} icon={dev.status === 'alert' ? icons.alert : icons.device}>
              <Popup>
                <strong>{dev.name}</strong><br/>
                Status: {dev.status === 'alert' ? 'Outside Zone' : 'Inside Zone'}<br/>
                Lat: {dev.lat.toFixed(4)}, Lng: {dev.lng.toFixed(4)}
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {/* Floating UI */}
      <div className="sidebar">
        
        {/* Header */}
        <div className="glass-panel header-panel">
          <div className="header-left">
            <div className="pulse-dot"></div>
            <div className="header-title">Tracker Hub</div>
          </div>
          <div className="user-info" title={userEmail}>
            <User size={14} /> 
            {userEmail.split('@')[0]}
          </div>
        </div>

        {/* Controls */}
        <div className="glass-panel controls-panel">
          <div className="status-row">
            <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>Focus Device</span>
            <Crosshair size={16} color="var(--text-secondary)" />
          </div>
          <select 
            className="device-select" 
            value={selectedDevice} 
            onChange={(e) => handleDeviceFocus(e.target.value)}
          >
            <option value="all">Show All</option>
            <option value="me">My Phone</option>
            {devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>

          <button className="btn" onClick={() => addNotification('info', 'Ping Sent', 'Requested location update from all devices.')}>
            <Navigation size={18} /> Ping Devices
          </button>
        </div>

        {/* Notifications */}
        <div className="glass-panel notifications-panel">
          <div className="notifications-header">
            <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Bell size={18} /> Alerts & Logs
            </span>
            <span style={{ fontSize: '0.8rem', background: 'rgba(59, 130, 246, 0.2)', padding: '2px 8px', borderRadius: '12px', color: 'var(--accent-color)' }}>
              {notifications.length} New
            </span>
          </div>
          <div className="notifications-list">
            {notifications.map(notif => (
              <div key={notif.id} className={`notification-item ${notif.extraClass}`}>
                <div className={`notif-icon ${notif.type}`}>
                  <NotificationIcon type={notif.type} />
                </div>
                <div className="notif-content">
                  <div className="notif-title">{notif.title}</div>
                  <div className="notif-desc">{notif.desc}</div>
                  <span className="notif-time">{notif.time}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

export default App;
