// Enhanced optimize API route with round-trip optimization
// This replaces optimize/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface Coordinates {
  lat: number;
  lng: number;
}

interface AppointmentData {
  id: string;
  client: string;
  address: string;
  appointmentType: string;
  duration: number;
  notes: string | null;
  latitude: number;
  longitude: number;
}

// Distance calculation using Haversine formula (fallback)
const calculateDistance = (coord1: Coordinates, coord2: Coordinates): number => {
  const R = 3959; // Earth's radius in miles
  const dLat = (coord2.lat - coord1.lat) * Math.PI / 180;
  const dLon = (coord2.lng - coord1.lng) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(coord1.lat * Math.PI / 180) * Math.cos(coord2.lat * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

// Enhanced round-trip optimization algorithm
const optimizeRoundTripRoute = (
  appointments: AppointmentData[],
  startLocation?: Coordinates
): { route: AppointmentData[], totalDistance: number } => {
  if (appointments.length <= 1) {
    let totalDistance = 0;
    if (appointments.length === 1 && startLocation) {
      const toAppointment = calculateDistance(
        startLocation,
        { lat: appointments[0].latitude, lng: appointments[0].longitude }
      );
      const returnTrip = calculateDistance(
        { lat: appointments[0].latitude, lng: appointments[0].longitude },
        startLocation
      );
      totalDistance = toAppointment + returnTrip;
    }
    return { route: appointments, totalDistance };
  }

  console.log('Starting round-trip optimization for', appointments.length, 'appointments');

  const origin = startLocation || { lat: appointments[0].latitude, lng: appointments[0].longitude };
  let bestRoute: AppointmentData[] = [];
  let bestTotalDistance = Infinity;

  // Try different ending appointments to find the best round-trip
  for (let endIndex = 0; endIndex < appointments.length; endIndex++) {
    const candidateRoute = optimizeSingleRoute(appointments, origin, endIndex);
    const totalDistance = calculateRoundTripDistance(candidateRoute, origin);

    if (totalDistance < bestTotalDistance) {
      bestTotalDistance = totalDistance;
      bestRoute = candidateRoute;
    }
  }

  console.log(`Best round-trip route: ${bestTotalDistance.toFixed(1)} miles total`);
  return { route: bestRoute, totalDistance: bestTotalDistance };
};

// Optimize a single route ending with a specific appointment
const optimizeSingleRoute = (
  appointments: AppointmentData[],
  origin: Coordinates,
  targetEndIndex: number
): AppointmentData[] => {
  const unvisited = [...appointments];
  const route: AppointmentData[] = [];
  let currentLocation = origin;
  const targetEndAppointment = appointments[targetEndIndex];

  while (unvisited.length > 0) {
    if (unvisited.length === 1) {
      // Add the last appointment
      route.push(unvisited[0]);
      break;
    }

    let nearestIndex = 0;
    let nearestDistance = Infinity;

    unvisited.forEach((appointment, index) => {
      // If this is the target end appointment and we have more than 1 left, skip it
      if (unvisited.length > 1 && appointment.id === targetEndAppointment.id) {
        return;
      }

      const distance = calculateDistance(
        currentLocation,
        { lat: appointment.latitude, lng: appointment.longitude }
      );

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    const nearestAppointment = unvisited.splice(nearestIndex, 1)[0];
    route.push(nearestAppointment);
    currentLocation = { lat: nearestAppointment.latitude, lng: nearestAppointment.longitude };
  }

  return route;
};

// Calculate total round-trip distance including return to origin
const calculateRoundTripDistance = (route: AppointmentData[], origin: Coordinates): number => {
  if (route.length === 0) return 0;

  let totalDistance = 0;

  // Distance from origin to first appointment
  totalDistance += calculateDistance(
    origin,
    { lat: route[0].latitude, lng: route[0].longitude }
  );

  // Distance between consecutive appointments
  for (let i = 0; i < route.length - 1; i++) {
    totalDistance += calculateDistance(
      { lat: route[i].latitude, lng: route[i].longitude },
      { lat: route[i + 1].latitude, lng: route[i + 1].longitude }
    );
  }

  // CRITICAL: Distance from last appointment back to origin
  const lastAppointment = route[route.length - 1];
  const returnDistance = calculateDistance(
    { lat: lastAppointment.latitude, lng: lastAppointment.longitude },
    origin
  );
  totalDistance += returnDistance;

  return totalDistance;
};

// Generate suggested appointment times with return trip consideration
const generateAppointmentTimes = (
  route: AppointmentData[],
  startTime: string = '09:00',
  travelTimePerMile: number = 3,
  origin?: Coordinates
): { times: string[], returnTime: string | null } => {
  const times: string[] = [];
  let currentTime = new Date(`2024-01-01 ${startTime}`);

  route.forEach((appointment, index) => {
    // Add travel time if not the first appointment
    if (index > 0) {
      const distance = calculateDistance(
        { lat: route[index - 1].latitude, lng: route[index - 1].longitude },
        { lat: appointment.latitude, lng: appointment.longitude }
      );
      const travelMinutes = Math.ceil(distance * travelTimePerMile);
      currentTime.setMinutes(currentTime.getMinutes() + travelMinutes);
    } else if (origin) {
      // Travel time from origin to first appointment
      const distance = calculateDistance(
        origin,
        { lat: appointment.latitude, lng: appointment.longitude }
      );
      const travelMinutes = Math.ceil(distance * travelTimePerMile);
      currentTime.setMinutes(currentTime.getMinutes() + travelMinutes);
    }

    times.push(currentTime.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    }));

    // Add appointment duration
    currentTime.setMinutes(currentTime.getMinutes() + appointment.duration);
  });

  // Calculate return time
  let returnTime: string | null = null;
  if (origin && route.length > 0) {
    const lastAppointment = route[route.length - 1];
    const returnDistance = calculateDistance(
      { lat: lastAppointment.latitude, lng: lastAppointment.longitude },
      origin
    );
    const returnTravelMinutes = Math.ceil(returnDistance * travelTimePerMile);
    currentTime.setMinutes(currentTime.getMinutes() + returnTravelMinutes);

    returnTime = currentTime.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  return { times, returnTime };
};

export async function POST(request: NextRequest) {
  try {
    const { startTime = '09:00', startingLocation } = await request.json();

    // For demo purposes, we'll use a hardcoded user ID
    const userId = 'demo-user';

    // Fetch all appointments for the user
    const appointments = await prisma.appointment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    if (appointments.length === 0) {
      return NextResponse.json(
        { error: 'No appointments found to optimize' },
        { status: 400 }
      );
    }

    console.log(`Optimizing ${appointments.length} appointments with round-trip consideration`);

    // Perform round-trip optimization
    const { route: optimizedRoute, totalDistance } = optimizeRoundTripRoute(
      appointments,
      startingLocation
    );

    // Generate appointment times including return trip calculation
    const { times: suggestedTimes, returnTime } = generateAppointmentTimes(
      optimizedRoute,
      startTime,
      3, // 3 minutes per mile
      startingLocation
    );

    // Calculate additional metrics
    const totalAppointmentTime = optimizedRoute.reduce((sum, apt) => sum + apt.duration, 0);
    const estimatedTotalTravelTime = Math.ceil(totalDistance * 3); // 3 minutes per mile

    // Update appointments with optimization results
    const updatePromises = optimizedRoute.map((appointment, index) =>
      prisma.appointment.update({
        where: { id: appointment.id },
        data: {
          optimizedOrder: index + 1,
          suggestedTime: suggestedTimes[index]
        }
      })
    );

    await Promise.all(updatePromises);

    // Fetch updated appointments
    const updatedAppointments = await prisma.appointment.findMany({
      where: { userId },
      orderBy: { optimizedOrder: 'asc' }
    });

    // Return comprehensive round-trip optimization results
    return NextResponse.json({
      optimizedRoute: updatedAppointments,
      totalDistance: totalDistance,
      totalTravelTime: estimatedTotalTravelTime,
      totalAppointmentTime: totalAppointmentTime,
      returnTime: returnTime,
      optimizationType: 'round-trip',
      summary: {
        totalStops: optimizedRoute.length,
        hasStartingLocation: !!startingLocation,
        estimatedDayDuration: estimatedTotalTravelTime + totalAppointmentTime,
        startTime: startTime,
        returnTime: returnTime
      }
    });

  } catch (error) {
    console.error('Error optimizing round-trip route:', error);
    return NextResponse.json(
      { error: 'Failed to optimize round-trip route' },
      { status: 500 }
    );
  }
}