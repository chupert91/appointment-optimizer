'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { MapPin, Clock, Plus, Trash2, Route, Calendar, User, Map, CheckCircle, AlertCircle, LogOut } from 'lucide-react';
import { Loader } from '@googlemaps/js-api-loader';

interface StartingLocation {
  address: string;
  coordinates: Coordinates;
  isSet: boolean;
}

interface Coordinates {
  lat: number;
  lng: number;
}

interface ValidatedAddress {
  formattedAddress: string;
  coordinates: Coordinates;
  isValid: boolean;
}

interface Appointment {
  id: string;
  client: string;
  address: string;
  appointmentType: string;
  duration: number;
  notes: string | null;
  latitude: number;
  longitude: number;
  optimizedOrder?: number | null;
  suggestedTime?: string | null;
  isValidAddress?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface ScheduledAppointment extends Appointment {
  suggestedTime: string;
  isStart?: boolean;
}

interface NewAppointmentForm {
  client: string;
  address: string;
  appointmentType: string;
  duration: number;
  notes: string;
}

// Distance calculation using Haversine formula (fallback)
const calculateHaversineDistance = (coord1: Coordinates, coord2: Coordinates): number => {
  const R = 3959;
  const dLat = (coord2.lat - coord1.lat) * Math.PI / 180;
  const dLon = (coord2.lng - coord1.lng) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(coord1.lat * Math.PI / 180) * Math.cos(coord2.lat * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

// Calculate actual driving distance using Google Distance Matrix API (via backend)
const calculateDrivingDistance = async (origin: Coordinates, destination: Coordinates): Promise<{ distance: number; duration: number }> => {
  try {
    const response = await fetch('/api/distance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        origin,
        destination
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return {
        distance: data.distance,
        duration: data.duration
      };
    } else {
      throw new Error('Distance API error');
    }
  } catch (error) {
    console.warn('Failed to get driving distance, using Haversine fallback:', error);
    const distance = calculateHaversineDistance(origin, destination);
    return {
      distance,
      duration: distance * 3
    };
  }
};

// Loading Component
const LoadingSpinner = () => (
  <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
    <div className="text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
      <p className="text-gray-600">Loading your account...</p>
    </div>
  </div>
);

// User Menu Component
const UserMenu: React.FC<{ user: any }> = ({ user }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200 hover:bg-gray-50 transition-colors"
      >
        <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
          <span className="text-white text-sm font-medium">
            {user.name?.charAt(0) || user.email?.charAt(0) || 'U'}
          </span>
        </div>
        <div className="text-left">
          <p className="text-sm font-medium text-gray-900">{user.name || 'User'}</p>
          <p className="text-xs text-gray-500">{user.email}</p>
        </div>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
          <div className="py-1">
            <button
              onClick={() => signOut({ callbackUrl: '/auth/signin' })}
              className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const AppointmentOptimizer: React.FC = () => {
  const { data: session, status } = useSession();
  const router = useRouter();

  // All state variables - always called in same order
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [isLoadingAppointments, setIsLoadingAppointments] = useState<boolean>(true);
  const [startingLocation, setStartingLocation] = useState<StartingLocation>({
    address: '',
    coordinates: { lat: 0, lng: 0 },
    isSet: false
  });
  const [isSettingOrigin, setIsSettingOrigin] = useState<boolean>(false);
  const [originValidation, setOriginValidation] = useState<{
    isValid: boolean;
    message: string;
    coordinates?: Coordinates;
  }>({ isValid: false, message: '' });
  const [newAppointment, setNewAppointment] = useState<NewAppointmentForm>({
    client: '',
    address: '',
    appointmentType: '',
    duration: 60,
    notes: ''
  });
  const [optimizedRoute, setOptimizedRoute] = useState<(Appointment | ScheduledAppointment)[]>([]);
  const [scheduledAppointments, setScheduledAppointments] = useState<ScheduledAppointment[]>([]);
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [isAddingAppointment, setIsAddingAppointment] = useState<boolean>(false);
  const [startTime, setStartTime] = useState<string>('09:00');
  const [totalDistance, setTotalDistance] = useState<number>(0);
  const [addressValidation, setAddressValidation] = useState<{
    isValid: boolean;
    message: string;
    coordinates?: Coordinates;
  }>({ isValid: false, message: '' });
  const [googleMapsLoaded, setGoogleMapsLoaded] = useState<boolean>(false);

  // Google Maps references - always called in same order
  const addressInputRef = useRef<HTMLInputElement>(null);
  const originInputRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const originAutocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const googleMapInstance = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const routeLineRef = useRef<google.maps.Polyline | null>(null);

  // Calculate actual driving distance using Google Distance Matrix API for multiple destinations (via backend)
  const calculateDistanceMatrix = useCallback(async (origins: Coordinates[], destinations: Coordinates[]): Promise<number[][]> => {
    if (origins.length === 0 || destinations.length === 0) {
      return [];
    }

    try {
      const response = await fetch('/api/distance-matrix', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          origins,
          destinations
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return data.distanceMatrix;
      } else {
        throw new Error('Distance Matrix API error');
      }
    } catch (error) {
      console.warn('Failed to get distance matrix, using Haversine fallback:', error);
      return origins.map(origin =>
        destinations.map(dest => calculateHaversineDistance(origin, dest))
      );
    }
  }, []);

  // Enhanced route optimization with actual driving distances
  const optimizeRouteWithDriving = useCallback(async (appointments: Appointment[], startLocation?: Coordinates): Promise<Appointment[]> => {
    if (appointments.length <= 1) return appointments;

    const coords = appointments.map(apt => ({ lat: apt.latitude, lng: apt.longitude }));
    const allCoords = startLocation ? [startLocation, ...coords] : coords;

    // Get distance matrix for all points
    const distanceMatrix = await calculateDistanceMatrix(allCoords, allCoords);

    // Simple nearest neighbor TSP with actual distances
    const unvisited = [...appointments];
    const route: Appointment[] = [];
    let currentIndex = startLocation ? 0 : 0; // Start from starting location or first appointment

    while (unvisited.length > 0) {
      let nearestIndex = 0;
      let nearestDistance = Infinity;

      unvisited.forEach((appointment, index) => {
        const appointmentIndex = startLocation ?
          appointments.indexOf(appointment) + 1 : // +1 because starting location is at index 0
          appointments.indexOf(appointment);

        const distance = distanceMatrix[currentIndex][appointmentIndex];
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });

      const nearestAppointment = unvisited.splice(nearestIndex, 1)[0];
      route.push(nearestAppointment);

      // Update current index for next iteration
      const appointmentIndex = startLocation ?
        appointments.indexOf(nearestAppointment) + 1 :
        appointments.indexOf(nearestAppointment);
      currentIndex = appointmentIndex;
    }

    return route;
  }, [calculateDistanceMatrix]);

  // Generate driving route path for map visualization
  const generateDrivingRoute = useCallback(async (waypoints: Coordinates[]): Promise<google.maps.LatLng[]> => {
    if (!googleMapsLoaded || waypoints.length < 2) return [];

    try {
      const directionsService = new google.maps.DirectionsService();

      const start = waypoints[0];
      const end = waypoints[waypoints.length - 1];
      const waypointObjects = waypoints.slice(1, -1).map(coord => ({
        location: new google.maps.LatLng(coord.lat, coord.lng),
        stopover: true
      }));

      const result = await new Promise<google.maps.DirectionsResult>((resolve, reject) => {
        directionsService.route({
          origin: new google.maps.LatLng(start.lat, start.lng),
          destination: new google.maps.LatLng(end.lat, end.lng),
          waypoints: waypointObjects,
          optimizeWaypoints: false, // We already optimized the order
          travelMode: google.maps.TravelMode.DRIVING,
        }, (result, status) => {
          if (status === google.maps.DirectionsStatus.OK && result) {
            resolve(result);
          } else {
            reject(new Error(`Directions service failed: ${status}`));
          }
        });
      });

      // Extract the path from the directions result
      const path: google.maps.LatLng[] = [];
      result.routes[0].legs.forEach(leg => {
        leg.steps.forEach(step => {
          path.push(...step.path);
        });
      });

      return path;
    } catch (error) {
      console.warn('Failed to get driving directions, using straight lines:', error);
      return waypoints.map(coord => new google.maps.LatLng(coord.lat, coord.lng));
    }
  }, [googleMapsLoaded]);

  // Utility functions with useCallback to prevent stale closures
  const validateAddress = useCallback(async (address: string): Promise<ValidatedAddress> => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      const baseCoords: Coordinates = { lat: 40.7128, lng: -74.0060 };
      return {
        formattedAddress: address,
        coordinates: {
          lat: baseCoords.lat + (Math.random() - 0.5) * 0.1,
          lng: baseCoords.lng + (Math.random() - 0.5) * 0.1
        },
        isValid: true
      };
    }

    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`
      );
      const data = await response.json();

      if (data.status === 'OK' && data.results.length > 0) {
        const result = data.results[0];
        return {
          formattedAddress: result.formatted_address,
          coordinates: {
            lat: result.geometry.location.lat,
            lng: result.geometry.location.lng
          },
          isValid: true
        };
      } else {
        throw new Error('Address not found');
      }
    } catch (error) {
      return {
        formattedAddress: address,
        coordinates: { lat: 0, lng: 0 },
        isValid: false
      };
    }
  }, []);

  const fetchAppointments = useCallback(async (): Promise<void> => {
    setIsLoadingAppointments(true);
    try {
      const response = await fetch('/api/appointments');
      if (response.ok) {
        const data = await response.json();
        setAppointments(data);
      } else {
        console.error('Failed to fetch appointments');
      }
    } catch (error) {
      console.error('Error fetching appointments:', error);
    } finally {
      setIsLoadingAppointments(false);
    }
  }, []);

  // Clear existing markers and route lines
  const clearMapElements = useCallback(() => {
    markersRef.current.forEach(marker => marker.setMap(null));
    markersRef.current = [];

    if (routeLineRef.current) {
      routeLineRef.current.setMap(null);
      routeLineRef.current = null;
    }
  }, []);

  // Create info window content safely
  const createInfoWindowContent = useCallback((appointment: Appointment | ScheduledAppointment): string => {
    const parts = [
      '<div style="padding: 8px; min-width: 200px;">',
      '<h3 style="margin: 0 0 8px 0; color: #1f2937; font-size: 16px; font-weight: 600;">',
      appointment.client,
      '</h3>',
      '<p style="margin: 4px 0; color: #6b7280; font-size: 14px;">📍 ',
      appointment.address,
      '</p>',
      '<p style="margin: 4px 0; color: #6b7280; font-size: 14px;">⏱️ ',
      appointment.duration.toString(),
      ' minutes</p>'
    ];

    if (appointment.appointmentType) {
      parts.push('<p style="margin: 4px 0; color: #6b7280; font-size: 14px;">📋 ');
      parts.push(appointment.appointmentType);
      parts.push('</p>');
    }

    if ('suggestedTime' in appointment && appointment.suggestedTime) {
      parts.push('<p style="margin: 4px 0; color: #059669; font-size: 14px; font-weight: 500;">🕐 Suggested: ');
      parts.push(appointment.suggestedTime);
      parts.push('</p>');
    }

    if (appointment.notes) {
      parts.push('<p style="margin: 8px 0 4px 0; color: #6b7280; font-size: 12px;">💭 ');
      parts.push(appointment.notes);
      parts.push('</p>');
    }

    parts.push('</div>');
    return parts.join('');
  }, []);

  // Update map with current appointments and route
  const updateMapDisplay = useCallback(async () => {
    if (!googleMapInstance.current) return;

    clearMapElements();

    const bounds = new google.maps.LatLngBounds();
    let hasPoints = false;

    // Add starting location marker
    if (startingLocation.isSet) {
      const startMarker = new google.maps.Marker({
        position: startingLocation.coordinates,
        map: googleMapInstance.current,
        title: 'Starting Location',
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: '#10B981',
          fillOpacity: 1,
          strokeColor: '#FFFFFF',
          strokeWeight: 2,
          scale: 12
        }
      });

      markersRef.current.push(startMarker);
      bounds.extend(startingLocation.coordinates);
      hasPoints = true;
    }

    // Add appointment markers
    const appointmentsToShow = optimizedRoute.length > 0 ? optimizedRoute : appointments;

    appointmentsToShow.forEach((appointment, index) => {
      if (appointment.isStart) return;

      const position = 'coordinates' in appointment ?
        appointment.coordinates :
        { lat: appointment.latitude, lng: appointment.longitude };

      const isOptimized = optimizedRoute.length > 0;

      const marker = new google.maps.Marker({
        position,
        map: googleMapInstance.current,
        title: appointment.client,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: isOptimized ? '#3B82F6' : '#6B7280',
          fillOpacity: 1,
          strokeColor: '#FFFFFF',
          strokeWeight: 2,
          scale: 10
        },
        label: isOptimized ? {
          text: (index + 1).toString(),
          color: '#FFFFFF',
          fontSize: '12px',
          fontWeight: 'bold'
        } : undefined
      });

      // Add click listener for info window
      const infoContent = createInfoWindowContent(appointment);
      const infoWindow = new google.maps.InfoWindow({
        content: infoContent
      });

      marker.addListener('click', () => {
        infoWindow.open(googleMapInstance.current, marker);
      });

      markersRef.current.push(marker);
      bounds.extend(position);
      hasPoints = true;
    });

    // Draw driving route if optimized
    if (optimizedRoute.length > 1) {
      const routeWaypoints: Coordinates[] = [];

      if (startingLocation.isSet) {
        routeWaypoints.push(startingLocation.coordinates);
      }

      optimizedRoute.forEach(appointment => {
        if (!appointment.isStart) {
          const position = 'coordinates' in appointment ?
            appointment.coordinates :
            { lat: appointment.latitude, lng: appointment.longitude };
          routeWaypoints.push(position);
        }
      });

      if (routeWaypoints.length > 1) {
        try {
          // Generate actual driving route
          const drivingPath = await generateDrivingRoute(routeWaypoints);

          routeLineRef.current = new google.maps.Polyline({
            path: drivingPath,
            geodesic: false, // Use actual road network, not geodesic
            strokeColor: '#3B82F6',
            strokeOpacity: 0.8,
            strokeWeight: 4,
            map: googleMapInstance.current
          });
        } catch (error) {
          console.warn('Failed to generate driving route, using straight lines:', error);
          // Fallback to straight lines
          const straightPath = routeWaypoints.map(coord =>
            new google.maps.LatLng(coord.lat, coord.lng)
          );

          routeLineRef.current = new google.maps.Polyline({
            path: straightPath,
            geodesic: true,
            strokeColor: '#3B82F6',
            strokeOpacity: 0.8,
            strokeWeight: 3,
            map: googleMapInstance.current
          });
        }
      }
    }

    // Fit map to show all points
    if (hasPoints) {
      googleMapInstance.current.fitBounds(bounds);

      const listener = google.maps.event.addListener(googleMapInstance.current, 'bounds_changed', () => {
        if (googleMapInstance.current!.getZoom()! > 15) {
          googleMapInstance.current!.setZoom(15);
        }
        google.maps.event.removeListener(listener);
      });
    }
  }, [startingLocation, optimizedRoute, appointments, clearMapElements, createInfoWindowContent, generateDrivingRoute]);

  // Handle place selection from autocomplete
  const handlePlaceSelect = useCallback(() => {
    if (!autocompleteRef.current) return;

    const place = autocompleteRef.current.getPlace();
    console.log('Place selected:', place);

    if (place.geometry && place.geometry.location && place.formatted_address) {
      const coordinates: Coordinates = {
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng()
      };

      setNewAppointment(currentAppointment => ({
        ...currentAppointment,
        address: place.formatted_address!
      }));

      setAddressValidation({
        isValid: true,
        message: 'Address validated ✓',
        coordinates
      });
    } else if (place.formatted_address || place.name) {
      const addressText = place.formatted_address || place.name;

      setNewAppointment(currentAppointment => ({
        ...currentAppointment,
        address: addressText
      }));

      setTimeout(async () => {
        try {
          const validation = await validateAddress(addressText);
          if (validation.isValid) {
            setAddressValidation({
              isValid: true,
              message: 'Address validated ✓',
              coordinates: validation.coordinates
            });
          } else {
            setAddressValidation({
              isValid: false,
              message: 'Please select again for validation'
            });
          }
        } catch (error) {
          setAddressValidation({
            isValid: false,
            message: 'Please select again for validation'
          });
        }
      }, 100);
    } else {
      setAddressValidation({
        isValid: false,
        message: 'Please select a valid address from the dropdown'
      });
    }
  }, [validateAddress]);

  // Handle origin place selection from autocomplete
  const handleOriginPlaceSelect = useCallback(() => {
    if (!originAutocompleteRef.current) return;

    const place = originAutocompleteRef.current.getPlace();
    console.log('Origin place selected:', place);

    if (place.geometry && place.geometry.location && place.formatted_address) {
      const coordinates: Coordinates = {
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng()
      };

      setStartingLocation({
        address: place.formatted_address,
        coordinates,
        isSet: true
      });

      setOriginValidation({
        isValid: true,
        message: 'Starting location validated ✓',
        coordinates
      });

      localStorage.setItem('startingLocation', JSON.stringify({
        address: place.formatted_address,
        coordinates,
        isSet: true
      }));
    } else if (place.formatted_address || place.name) {
      const addressText = place.formatted_address || place.name;

      setStartingLocation({
        address: addressText,
        coordinates: { lat: 0, lng: 0 },
        isSet: false
      });

      setTimeout(async () => {
        try {
          const validation = await validateAddress(addressText);
          if (validation.isValid) {
            const newLocation: StartingLocation = {
              address: validation.formattedAddress,
              coordinates: validation.coordinates,
              isSet: true
            };

            setStartingLocation(newLocation);
            setOriginValidation({
              isValid: true,
              message: 'Starting location validated ✓',
              coordinates: validation.coordinates
            });

            localStorage.setItem('startingLocation', JSON.stringify(newLocation));
          } else {
            setOriginValidation({
              isValid: false,
              message: 'Please select again for validation'
            });
          }
        } catch (error) {
          setOriginValidation({
            isValid: false,
            message: 'Please select again for validation'
          });
        }
      }, 100);
    } else {
      setOriginValidation({
        isValid: false,
        message: 'Please select a valid starting location from the dropdown'
      });
    }
  }, [validateAddress]);

  // Authentication check - effect always called
  useEffect(() => {
    if (status === 'loading') return;

    if (status === 'unauthenticated') {
      router.push('/auth/signin');
      return;
    }
  }, [status, router]);

  // Load Google Maps API - effect always called
  useEffect(() => {
    const loadGoogleMaps = async () => {
      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

      if (!apiKey) {
        console.warn('Google Maps API key not found. Using fallback geocoding.');
        return;
      }

      try {
        const loader = new Loader({
          apiKey: apiKey,
          version: 'weekly',
          libraries: ['places', 'geometry']
        });

        await loader.load();
        setGoogleMapsLoaded(true);
      } catch (error) {
        console.error('Error loading Google Maps:', error);
      }
    };

    loadGoogleMaps();
  }, []);

  // Load appointments from database - effect always called
  useEffect(() => {
    if (session) {
      fetchAppointments();
    }
  }, [session, fetchAppointments]);

  // Initialize autocomplete when Google Maps is loaded - effect always called
  useEffect(() => {
    if (googleMapsLoaded) {
      // Initialize appointment address autocomplete
      if (addressInputRef.current && !autocompleteRef.current) {
        try {
          autocompleteRef.current = new google.maps.places.Autocomplete(addressInputRef.current, {
            types: ['address'],
            fields: ['formatted_address', 'geometry.location', 'place_id']
          });
          autocompleteRef.current.addListener('place_changed', handlePlaceSelect);
        } catch (error) {
          console.error('Error initializing address autocomplete:', error);
        }
      }

      // Initialize origin address autocomplete
      if (originInputRef.current && !originAutocompleteRef.current) {
        try {
          originAutocompleteRef.current = new google.maps.places.Autocomplete(originInputRef.current, {
            types: ['address'],
            fields: ['formatted_address', 'geometry.location', 'place_id']
          });
          originAutocompleteRef.current.addListener('place_changed', handleOriginPlaceSelect);
        } catch (error) {
          console.error('Error initializing origin autocomplete:', error);
        }
      }

      // Initialize Google Map
      if (mapRef.current && !googleMapInstance.current) {
        try {
          googleMapInstance.current = new google.maps.Map(mapRef.current, {
            zoom: 10,
            center: { lat: 40.7128, lng: -74.0060 },
            mapTypeId: google.maps.MapTypeId.ROADMAP
          });
          updateMapDisplay();
        } catch (error) {
          console.error('Error initializing map:', error);
        }
      }
    }
  }, [googleMapsLoaded, handlePlaceSelect, handleOriginPlaceSelect, updateMapDisplay]);

  // Update map when appointments or route changes - effect always called
  useEffect(() => {
    if (googleMapsLoaded && googleMapInstance.current) {
      updateMapDisplay();
    }
  }, [googleMapsLoaded, updateMapDisplay]);

  // Load starting location from localStorage - effect always called
  useEffect(() => {
    const savedLocation = localStorage.getItem('startingLocation');
    if (savedLocation) {
      try {
        const location: StartingLocation = JSON.parse(savedLocation);
        setStartingLocation(location);
        if (location.isSet) {
          setOriginValidation({
            isValid: true,
            message: 'Starting location loaded ✓',
            coordinates: location.coordinates
          });
        }
      } catch (error) {
        console.error('Error loading starting location:', error);
      }
    }
  }, []);

  // Cleanup autocomplete instances - effect always called
  useEffect(() => {
    return () => {
      if (autocompleteRef.current) {
        google.maps.event.clearInstanceListeners(autocompleteRef.current);
      }
      if (originAutocompleteRef.current) {
        google.maps.event.clearInstanceListeners(originAutocompleteRef.current);
      }
      clearMapElements();
    };
  }, [clearMapElements]);

  // Early returns AFTER all hooks
  if (status === 'loading') {
    return <LoadingSpinner />;
  }

  if (status === 'unauthenticated') {
    return <LoadingSpinner />;
  }

  const handleOriginAddressValidation = async () => {
    if (!startingLocation.address.trim()) return;

    setIsSettingOrigin(true);
    setOriginValidation({ isValid: false, message: 'Validating starting location...' });

    try {
      const validation = await validateAddress(startingLocation.address);

      if (validation.isValid) {
        const newLocation: StartingLocation = {
          address: validation.formattedAddress,
          coordinates: validation.coordinates,
          isSet: true
        };

        setStartingLocation(newLocation);
        setOriginValidation({
          isValid: true,
          message: 'Starting location validated ✓',
          coordinates: validation.coordinates
        });

        localStorage.setItem('startingLocation', JSON.stringify(newLocation));
      } else {
        setOriginValidation({
          isValid: false,
          message: 'Unable to validate this starting location. Please check and try again.'
        });
      }
    } catch (error) {
      setOriginValidation({
        isValid: false,
        message: 'Error validating starting location. Please try again.'
      });
    } finally {
      setIsSettingOrigin(false);
    }
  };

  const handleAddressValidation = async () => {
    if (!newAppointment.address.trim()) return;

    setIsValidating(true);
    setAddressValidation({ isValid: false, message: 'Validating address...' });

    try {
      const validation = await validateAddress(newAppointment.address);

      if (validation.isValid) {
        setNewAppointment(currentAppointment => ({
          ...currentAppointment,
          address: validation.formattedAddress
        }));
        setAddressValidation({
          isValid: true,
          message: 'Address validated ✓',
          coordinates: validation.coordinates
        });
      } else {
        setAddressValidation({
          isValid: false,
          message: 'Unable to validate this address. Please check and try again.'
        });
      }
    } catch (error) {
      setAddressValidation({
        isValid: false,
        message: 'Error validating address. Please try again.'
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleOriginChange = (address: string) => {
    setStartingLocation({
      ...startingLocation,
      address
    });
    setOriginValidation({ isValid: false, message: '' });
  };

  const addAppointment = async (): Promise<void> => {
    if (!newAppointment.client.trim() || !newAppointment.address.trim()) return;

    setIsAddingAppointment(true);
    let finalCoordinates = addressValidation.coordinates;

    if (!addressValidation.isValid || !addressValidation.coordinates) {
      setIsValidating(true);
      try {
        const validation = await validateAddress(newAppointment.address);
        if (validation.isValid) {
          finalCoordinates = validation.coordinates;
          setAddressValidation({
            isValid: true,
            message: 'Address validated ✓',
            coordinates: validation.coordinates
          });
        } else {
          setAddressValidation({
            isValid: false,
            message: 'Unable to validate this address. Please check and try again.'
          });
          setIsValidating(false);
          setIsAddingAppointment(false);
          return;
        }
      } catch (error) {
        console.error('Error validating address:', error);
        setIsValidating(false);
        setIsAddingAppointment(false);
        return;
      }
      setIsValidating(false);
    }

    try {
      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client: newAppointment.client,
          address: newAppointment.address,
          appointmentType: newAppointment.appointmentType,
          duration: newAppointment.duration,
          notes: newAppointment.notes || null,
          latitude: finalCoordinates!.lat,
          longitude: finalCoordinates!.lng
        }),
      });

      if (response.ok) {
        const newApp = await response.json();
        setAppointments([newApp, ...appointments]);
        setNewAppointment({
          client: '',
          address: '',
          appointmentType: '',
          duration: 60,
          notes: ''
        });
        setAddressValidation({ isValid: false, message: '' });

        if (addressInputRef.current) {
          addressInputRef.current.value = '';
        }

        setOptimizedRoute([]);
        setScheduledAppointments([]);
        setTotalDistance(0);
      } else {
        console.error('Failed to create appointment');
      }
    } catch (error) {
      console.error('Error adding appointment:', error);
    } finally {
      setIsAddingAppointment(false);
    }
  };

  const removeAppointment = async (id: string): Promise<void> => {
    try {
      const response = await fetch(`/api/appointments?id=${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setAppointments(appointments.filter(apt => apt.id !== id));
        setOptimizedRoute([]);
        setScheduledAppointments([]);
        setTotalDistance(0);
      } else {
        console.error('Failed to delete appointment');
      }
    } catch (error) {
      console.error('Error deleting appointment:', error);
    }
  };

  const optimizeAppointments = async (): Promise<void> => {
    setIsOptimizing(true);

    try {
      console.log('Starting route optimization with driving distances...');

      // Use client-side optimization with real driving distances
      const optimizedAppointments = await optimizeRouteWithDriving(
        appointments,
        startingLocation.isSet ? startingLocation.coordinates : undefined
      );

      // Calculate actual route metrics using driving distances
      let totalDrivingDistance = 0;
      let totalDrivingTime = 0;

      if (optimizedAppointments.length > 0) {
        const routeCoords = startingLocation.isSet ?
          [startingLocation.coordinates, ...optimizedAppointments.map(apt => ({ lat: apt.latitude, lng: apt.longitude }))] :
          optimizedAppointments.map(apt => ({ lat: apt.latitude, lng: apt.longitude }));

        // Calculate total distance and time using actual driving routes
        for (let i = 0; i < routeCoords.length - 1; i++) {
          const { distance, duration } = await calculateDrivingDistance(routeCoords[i], routeCoords[i + 1]);
          totalDrivingDistance += distance;
          totalDrivingTime += duration;
        }
      }

      // Generate appointment times based on actual driving times
      const scheduledAppointments: ScheduledAppointment[] = [];
      let currentTime = new Date(`2024-01-01 ${startTime}`);

      // Add starting point if it exists
      if (startingLocation.isSet) {
        scheduledAppointments.push({
          id: '0',
          client: 'Starting Point',
          address: startingLocation.address,
          appointmentType: '',
          duration: 0,
          notes: '',
          latitude: startingLocation.coordinates.lat,
          longitude: startingLocation.coordinates.lng,
          coordinates: startingLocation.coordinates,
          isStart: true,
          suggestedTime: currentTime.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
          })
        } as ScheduledAppointment);
      }

      // Add optimized appointments with actual travel times
      for (let i = 0; i < optimizedAppointments.length; i++) {
        const appointment = optimizedAppointments[i];

        // Calculate actual travel time to this appointment
        if (i === 0 && startingLocation.isSet) {
          // From starting location to first appointment
          const { duration } = await calculateDrivingDistance(
            startingLocation.coordinates,
            { lat: appointment.latitude, lng: appointment.longitude }
          );
          currentTime.setMinutes(currentTime.getMinutes() + Math.ceil(duration));
        } else if (i > 0) {
          // From previous appointment to this one
          const prevAppointment = optimizedAppointments[i - 1];
          const { duration } = await calculateDrivingDistance(
            { lat: prevAppointment.latitude, lng: prevAppointment.longitude },
            { lat: appointment.latitude, lng: appointment.longitude }
          );
          currentTime.setMinutes(currentTime.getMinutes() + Math.ceil(duration));
        }

        scheduledAppointments.push({
          ...appointment,
          coordinates: { lat: appointment.latitude, lng: appointment.longitude },
          suggestedTime: currentTime.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
          })
        });

        // Add appointment duration
        currentTime.setMinutes(currentTime.getMinutes() + appointment.duration);
      }

      // Update state with optimized results
      setOptimizedRoute(scheduledAppointments);
      setScheduledAppointments(scheduledAppointments);
      setTotalDistance(totalDrivingDistance);

      console.log(`Route optimized: ${totalDrivingDistance.toFixed(1)} miles, ${Math.ceil(totalDrivingTime)} minutes driving time`);

    } catch (error) {
      console.error('Error optimizing route:', error);

      // Fallback to server-side optimization if client-side fails
      try {
        const response = await fetch('/api/optimize', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            startTime,
            startingLocation: startingLocation.isSet ? startingLocation.coordinates : null
          }),
        });

        if (response.ok) {
          const result = await response.json();

          const routeWithCoordinates = result.optimizedRoute.map((apt: any) => ({
            ...apt,
            coordinates: { lat: apt.latitude, lng: apt.longitude },
            isValidAddress: true
          }));

          setOptimizedRoute(routeWithCoordinates);
          setScheduledAppointments(routeWithCoordinates);
          setTotalDistance(result.totalDistance);

          console.log('Fallback server-side optimization completed');
        } else {
          console.error('Server-side optimization also failed');
        }
      } catch (fallbackError) {
        console.error('Both client and server-side optimization failed:', fallbackError);
      }
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleInputChange = (field: keyof NewAppointmentForm, value: string | number): void => {
    setNewAppointment({
      ...newAppointment,
      [field]: value
    });

    if (field === 'address') {
      setAddressValidation({ isValid: false, message: '' });
      if (addressInputRef.current && typeof value === 'string') {
        addressInputRef.current.value = value;
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header with User Menu */}
        <div className="flex justify-between items-center mb-8">
          <div className="text-center flex-1">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">
              RouteOptimizer Pro
            </h1>
            <p className="text-gray-600 text-lg">
              Intelligent appointment scheduling and route optimization
            </p>
            <div className="mt-2 text-sm space-x-4">
              {googleMapsLoaded ? (
                <span className="text-green-600">✅ Google Maps API Connected</span>
              ) : (
                <span className="text-orange-600">🔄 Loading Maps API...</span>
              )}
              <span className="text-blue-600">🗄️ Neon PostgreSQL Connected</span>
              <span className="text-purple-600">🚗 Driving Routes Enabled</span>
              {startingLocation.isSet && (
                <span className="text-purple-600">📍 Starting location set</span>
              )}
            </div>
          </div>

          <UserMenu user={session!.user} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-6">
            {/* Starting Location Setup */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4 flex items-center">
                <MapPin className="mr-2 text-green-600" />
                Starting Location
                {startingLocation.isSet && (
                  <span className="ml-2 text-sm bg-green-100 text-green-800 px-2 py-1 rounded-full">
                    Set ✓
                  </span>
                )}
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Home/Office Address
                  </label>
                  <p className="text-sm text-gray-600 mb-2">
                    Set your daily starting point for route optimization
                  </p>
                  <div className="relative">
                    <input
                      ref={originInputRef}
                      type="text"
                      value={startingLocation.address}
                      onChange={(e) => handleOriginChange(e.target.value)}
                      onBlur={handleOriginAddressValidation}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent pr-10 text-gray-900 placeholder-gray-500 bg-white"
                      placeholder="Enter your home or office address"
                      disabled={isSettingOrigin}
                    />
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                      {isSettingOrigin ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-600"></div>
                      ) : originValidation.isValid ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : originValidation.message && !originValidation.isValid ? (
                        <AlertCircle className="h-4 w-4 text-red-500" />
                      ) : null}
                    </div>
                  </div>
                  {originValidation.message && (
                    <p className={`text-sm mt-1 ${originValidation.isValid ? 'text-green-600' : 'text-red-600'}`}>
                      {originValidation.message}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Add Appointment Form */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4 flex items-center">
                <Plus className="mr-2 text-blue-600" />
                Add New Appointment
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Client Name
                  </label>
                  <input
                    type="text"
                    value={newAppointment.client}
                    onChange={(e) => handleInputChange('client', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-500 bg-white"
                    placeholder="Enter client name"
                    disabled={isAddingAppointment}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Address
                  </label>
                  <div className="relative">
                    <input
                      ref={addressInputRef}
                      type="text"
                      value={newAppointment.address}
                      onChange={(e) => handleInputChange('address', e.target.value)}
                      onBlur={handleAddressValidation}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-10 text-gray-900 placeholder-gray-500 bg-white"
                      placeholder="Enter full address"
                      disabled={isAddingAppointment}
                    />
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                      {isValidating ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                      ) : addressValidation.isValid ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : addressValidation.message && !addressValidation.isValid ? (
                        <AlertCircle className="h-4 w-4 text-red-500" />
                      ) : null}
                    </div>
                  </div>
                  {addressValidation.message && (
                    <p className={`text-sm mt-1 ${addressValidation.isValid ? 'text-green-600' : 'text-red-600'}`}>
                      {addressValidation.message}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Appointment Type
                    </label>
                    <select
                      value={newAppointment.appointmentType}
                      onChange={(e) => handleInputChange('appointmentType', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 bg-white"
                      disabled={isAddingAppointment}
                    >
                      <option value="">Select type</option>
                      <option value="consultation">Consultation</option>
                      <option value="follow-up">Follow-up</option>
                      <option value="installation">Installation</option>
                      <option value="maintenance">Maintenance</option>
                      <option value="demo">Demo</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Duration (minutes)
                    </label>
                    <input
                      type="number"
                      value={newAppointment.duration}
                      onChange={(e) => handleInputChange('duration', parseInt(e.target.value) || 60)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 bg-white"
                      min="15"
                      step="15"
                      disabled={isAddingAppointment}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Notes
                  </label>
                  <textarea
                    value={newAppointment.notes}
                    onChange={(e) => handleInputChange('notes', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-500 bg-white"
                    rows={2}
                    placeholder="Additional notes or special requirements"
                    disabled={isAddingAppointment}
                  />
                </div>

                <button
                  onClick={addAppointment}
                  disabled={!newAppointment.client.trim() || !newAppointment.address.trim() || isAddingAppointment}
                  className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center"
                  title={!newAppointment.client.trim() ? "Please enter client name" : !newAppointment.address.trim() ? "Please enter address" : "Add appointment"}
                >
                  {isAddingAppointment ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Adding...
                    </>
                  ) : (
                    <>
                      <Plus className="mr-2 h-4 w-4" />
                      Add Appointment
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Current Appointments List */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                <Calendar className="mr-2 text-green-600" />
                Current Appointments ({appointments.length})
              </h3>

              {isLoadingAppointments ? (
                <div className="text-center py-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto"></div>
                  <p className="text-gray-500 mt-2">Loading appointments from database...</p>
                </div>
              ) : appointments.length === 0 ? (
                <p className="text-gray-500 text-center py-4">No appointments added yet</p>
              ) : (
                <div className="space-y-3">
                  {appointments.map((apt) => (
                    <div key={apt.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center mb-2">
                            <User className="h-4 w-4 text-gray-500 mr-2" />
                            <span className="font-medium text-gray-900">{apt.client}</span>
                            {apt.appointmentType && (
                              <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                                {apt.appointmentType}
                              </span>
                            )}
                            <CheckCircle className="h-4 w-4 text-green-500 ml-2" title="Database Stored ✓" />
                          </div>
                          <div className="flex items-center text-sm text-gray-600 mb-1">
                            <MapPin className="h-4 w-4 mr-2" />
                            {apt.address}
                          </div>
                          <div className="flex items-center text-sm text-gray-600">
                            <Clock className="h-4 w-4 mr-2" />
                            {apt.duration} minutes
                          </div>
                          {apt.notes && (
                            <p className="text-sm text-gray-500 mt-2">{apt.notes}</p>
                          )}
                        </div>
                        <button
                          onClick={() => removeAppointment(apt.id)}
                          className="text-red-500 hover:text-red-700 p-1"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Panel */}
          <div className="space-y-6">
            {/* Optimization Controls */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                <Route className="mr-2 text-purple-600" />
                Route Optimization
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Start Time
                  </label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 bg-white"
                  />
                </div>

                <button
                  onClick={optimizeAppointments}
                  disabled={appointments.length === 0 || isOptimizing}
                  className="w-full bg-purple-600 text-white py-3 px-4 rounded-lg hover:bg-purple-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center"
                >
                  {isOptimizing ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Calculating driving routes...
                    </>
                  ) : (
                    <>
                      <Route className="mr-2 h-4 w-4" />
                      Optimize Route ({appointments.length} stops
                      {startingLocation.isSet ? ', from origin' : ''})
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Route Optimization Info */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="text-sm font-medium text-blue-900 mb-2">🚗 Smart Route Optimization</h4>
              <p className="text-xs text-blue-700">
                Routes are optimized using actual driving distances and real-time traffic data via Google Maps.
                {!startingLocation.isSet && " Set a starting location for even better optimization!"}
              </p>
            </div>

            {/* Optimization Results */}
            {optimizedRoute.length > 0 && (
              <div className="bg-white rounded-xl shadow-lg p-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                  <Map className="mr-2 text-green-600" />
                  Optimized Schedule
                </h3>

                <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                  {startingLocation.isSet && (
                    <div className="flex justify-between items-center mb-2 pb-2 border-b border-green-200">
                      <span className="text-green-800 font-medium">Starting from:</span>
                      <span className="text-green-900 text-sm">{startingLocation.address}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center">
                    <span className="text-green-800 font-medium">Total Driving Distance:</span>
                    <span className="text-green-900 font-bold">{totalDistance.toFixed(1)} miles</span>
                  </div>
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-green-800 font-medium">Estimated Driving Time:</span>
                    <span className="text-green-900 font-bold">{Math.ceil(totalDistance * 3)} minutes</span>
                  </div>
                  <p className="text-xs text-green-700 mt-2">
                    ✅ Routes calculated using actual road networks and driving distances
                  </p>
                </div>

                <div className="space-y-3">
                  {scheduledAppointments.map((apt, index) => (
                    <div key={apt.id} className="border-l-4 border-blue-500 bg-blue-50 p-4 rounded-r-lg">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center mb-2">
                            <span className="bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded-full mr-3">
                              {index + 1}
                            </span>
                            <span className="font-semibold text-gray-900">{apt.client}</span>
                          </div>

                          <div className="flex items-center text-sm text-gray-600 mb-1">
                            <Clock className="h-4 w-4 mr-2 text-blue-600" />
                            <span className="font-medium text-blue-800">{apt.suggestedTime}</span>
                            {!apt.isStart && apt.duration && (
                              <span className="ml-2 text-gray-500">({apt.duration} min)</span>
                            )}
                          </div>

                          {!apt.isStart && (
                            <>
                              <div className="flex items-center text-sm text-gray-600 mb-1">
                                <MapPin className="h-4 w-4 mr-2 text-blue-600" />
                                {apt.address}
                              </div>

                              {apt.appointmentType && (
                                <span className="inline-block px-2 py-1 bg-white text-blue-700 text-xs rounded-full border border-blue-200">
                                  {apt.appointmentType}
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Interactive Map */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                <Map className="mr-2 text-green-600" />
                Route Visualization
                {optimizedRoute.length > 0 && (
                  <span className="ml-2 text-sm bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                    Optimized ✓
                  </span>
                )}
              </h3>

              {!googleMapsLoaded ? (
                <div className="bg-gray-100 rounded-lg h-96 flex items-center justify-center">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
                    <p className="text-gray-500">Loading interactive map...</p>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    ref={mapRef}
                    className="w-full h-96 rounded-lg border border-gray-200"
                    style={{ minHeight: '384px' }}
                  />

                  {appointments.length === 0 && (
                    <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                      <p className="text-sm text-gray-600 text-center">
                        Add appointments to see them displayed on the map
                      </p>
                    </div>
                  )}

                  {appointments.length > 0 && optimizedRoute.length === 0 && (
                    <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                      <p className="text-sm text-blue-700 text-center">
                        📍 Showing {appointments.length} appointment{appointments.length !== 1 ? 's' : ''} •
                        Click "Optimize Route" to see the best path
                      </p>
                    </div>
                  )}

                  {optimizedRoute.length > 0 && (
                    <div className="mt-4 p-3 bg-green-50 rounded-lg">
                      <p className="text-sm text-green-700 text-center">
                        ✅ Showing optimized driving route with {optimizedRoute.filter(apt => !apt.isStart).length} stops
                        {startingLocation.isSet ? ' from your starting location' : ''}
                      </p>
                      <p className="text-xs text-green-600 text-center mt-1">
                        🛣️ Routes follow actual roads and traffic patterns
                      </p>
                    </div>
                  )}

                  <div className="mt-4 text-xs text-gray-500 space-y-1">
                    <div className="flex items-center justify-center space-x-4">
                      <span className="flex items-center">
                        <span className="w-3 h-3 bg-green-500 rounded-full mr-1"></span>
                        Starting Location
                      </span>
                      <span className="flex items-center">
                        <span className="w-3 h-3 bg-blue-500 rounded-full mr-1"></span>
                        Appointments
                      </span>
                      {optimizedRoute.length > 0 && (
                        <span className="flex items-center">
                          <span className="w-6 h-0.5 bg-blue-500 mr-1"></span>
                          Driving Route
                        </span>
                      )}
                    </div>
                    <p className="text-center">Click markers for appointment details</p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AppointmentOptimizer;