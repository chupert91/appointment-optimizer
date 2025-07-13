import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

interface Coordinates {
  lat: number;
  lng: number;
}

// Calculate driving distance using Google Distance Matrix API
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { origin, destination } = await request.json();

    if (!origin || !destination || !origin.lat || !origin.lng || !destination.lat || !destination.lng) {
      return NextResponse.json(
        { error: 'Invalid coordinates provided' },
        { status: 400 }
      );
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      // Fallback to Haversine distance calculation
      const R = 3959; // Earth's radius in miles
      const dLat = (destination.lat - origin.lat) * Math.PI / 180;
      const dLon = (destination.lng - origin.lng) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(origin.lat * Math.PI / 180) * Math.cos(destination.lat * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distance = R * c;

      return NextResponse.json({
        distance,
        duration: distance * 3 // Estimate 3 minutes per mile
      });
    }

    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/distancematrix/json?` +
        `origins=${origin.lat},${origin.lng}&` +
        `destinations=${destination.lat},${destination.lng}&` +
        `units=imperial&` +
        `mode=driving&` +
        `key=${apiKey}`
      );

      const data = await response.json();

      if (data.status === 'OK' && data.rows[0]?.elements[0]?.status === 'OK') {
        const element = data.rows[0].elements[0];
        const distanceInMiles = element.distance.value * 0.000621371; // Convert meters to miles
        const durationInMinutes = element.duration.value / 60; // Convert seconds to minutes

        return NextResponse.json({
          distance: distanceInMiles,
          duration: durationInMinutes
        });
      } else {
        throw new Error(`Google API error: ${data.status}`);
      }
    } catch (error) {
      console.error('Google Distance Matrix API error:', error);

      // Fallback to Haversine calculation
      const R = 3959;
      const dLat = (destination.lat - origin.lat) * Math.PI / 180;
      const dLon = (destination.lng - origin.lng) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(origin.lat * Math.PI / 180) * Math.cos(destination.lat * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distance = R * c;

      return NextResponse.json({
        distance,
        duration: distance * 3
      });
    }

  } catch (error) {
    console.error('Error calculating distance:', error);
    return NextResponse.json(
      { error: 'Failed to calculate distance' },
      { status: 500 }
    );
  }
}