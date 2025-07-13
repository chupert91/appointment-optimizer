import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { PrismaClient } from '@prisma/client';
import { authOptions } from '@/lib/auth';

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

// Distance calculation using Haversine formula
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

// Simple nearest neighbor TSP solver with optional starting location
const optimizeRoute = (appointments: AppointmentData[], startLocation?: Coordinates): AppointmentData[] => {
  if (appointments.length <= 1) return appointments;

  const unvisited = [...appointments];
  const route: AppointmentData[] = [];
  let currentLocation = startLocation || { lat: appointments[0].latitude, lng: appointments[0].longitude };

  while (unvisited.length > 0) {
    let nearestIndex = 0;
    let nearestDistance = Infinity;

    unvisited.forEach((appointment, index) => {
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

// Generate suggested appointment times
const generateAppointmentTimes = (
  route: AppointmentData[],
  startTime: string = '09:00',
  travelTimePerMile: number = 3
): string[] => {
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
    }

    times.push(currentTime.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    }));

    // Add appointment duration
    currentTime.setMinutes(currentTime.getMinutes() + appointment.duration);
  });

  return times;
};

// Calculate total route distance
const calculateTotalDistance = (route: AppointmentData[], startLocation?: Coordinates): number => {
  if (route.length <= 1) return 0;

  let totalDistance = 0;
  let currentLocation = startLocation;

  // If we have a starting location, calculate distance from start to first appointment
  if (startLocation && route.length > 0) {
    totalDistance += calculateDistance(startLocation, { lat: route[0].latitude, lng: route[0].longitude });
  }

  // Calculate distances between appointments
  for (let i = 0; i < route.length - 1; i++) {
    totalDistance += calculateDistance(
      { lat: route[i].latitude, lng: route[i].longitude },
      { lat: route[i + 1].latitude, lng: route[i + 1].longitude }
    );
  }

  return totalDistance;
};

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { startTime = '09:00', startingLocation } = await request.json();

    // Fetch all appointments for the authenticated user
    const appointments = await prisma.appointment.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' }
    });

    if (appointments.length === 0) {
      return NextResponse.json(
        { error: 'No appointments found to optimize' },
        { status: 400 }
      );
    }

    // Parse starting location if provided
    let startCoords: Coordinates | undefined;
    if (startingLocation && startingLocation.lat && startingLocation.lng) {
      startCoords = {
        lat: parseFloat(startingLocation.lat),
        lng: parseFloat(startingLocation.lng)
      };
    }

    // Optimize the route
    const optimizedRoute = optimizeRoute(appointments, startCoords);
    const suggestedTimes = generateAppointmentTimes(optimizedRoute, startTime);
    const totalDistance = calculateTotalDistance(optimizedRoute, startCoords);

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
      where: { userId: session.user.id },
      orderBy: { optimizedOrder: 'asc' }
    });

    return NextResponse.json({
      optimizedRoute: updatedAppointments,
      totalDistance,
      totalTravelTime: Math.ceil(totalDistance * 3),
      startingLocation: startCoords
    });

  } catch (error) {
    console.error('Error optimizing route:', error);
    return NextResponse.json(
      { error: 'Failed to optimize route' },
      { status: 500 }
    );
  }
}