import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

interface Coordinates {
  lat: number;
  lng: number;
}

// Haversine distance calculation fallback
const calculateHaversineDistance = (coord1: Coordinates, coord2: Coordinates): number => {
  const R = 3959; // Earth's radius in miles
  const dLat = (coord2.lat - coord1.lat) * Math.PI / 180;
  const dLon = (coord2.lng - coord1.lng) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(coord1.lat * Math.PI / 180) * Math.cos(coord2.lat * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

// Calculate distance matrix using Google Distance Matrix API
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { origins, destinations } = await request.json();

    if (!Array.isArray(origins) || !Array.isArray(destinations) || origins.length === 0 || destinations.length === 0) {
      return NextResponse.json(
        { error: 'Invalid origins or destinations provided' },
        { status: 400 }
      );
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      // Fallback to Haversine distance calculations
      const distanceMatrix = origins.map(origin =>
        destinations.map(dest => calculateHaversineDistance(origin, dest))
      );

      return NextResponse.json({
        distanceMatrix
      });
    }

    try {
      // Batch multiple origins/destinations in single API call
      const originsParam = origins.map(coord => `${coord.lat},${coord.lng}`).join('|');
      const destinationsParam = destinations.map(coord => `${coord.lat},${coord.lng}`).join('|');

      const response = await fetch(
        `https://maps.googleapis.com/maps/api/distancematrix/json?` +
        `origins=${encodeURIComponent(originsParam)}&` +
        `destinations=${encodeURIComponent(destinationsParam)}&` +
        `units=imperial&` +
        `mode=driving&` +
        `key=${apiKey}`
      );

      const data = await response.json();

      if (data.status === 'OK') {
        const distanceMatrix = data.rows.map((row: any, originIndex: number) =>
          row.elements.map((element: any, destIndex: number) => {
            if (element.status === 'OK') {
              return element.distance.value * 0.000621371; // Convert meters to miles
            } else {
              // Fallback to Haversine for failed elements
              return calculateHaversineDistance(origins[originIndex], destinations[destIndex]);
            }
          })
        );

        return NextResponse.json({
          distanceMatrix
        });
      } else {
        throw new Error(`Google API error: ${data.status}`);
      }
    } catch (error) {
      console.error('Google Distance Matrix API error:', error);

      // Fallback to Haversine calculations
      const distanceMatrix = origins.map(origin =>
        destinations.map(dest => calculateHaversineDistance(origin, dest))
      );

      return NextResponse.json({
        distanceMatrix
      });
    }

  } catch (error) {
    console.error('Error calculating distance matrix:', error);
    return NextResponse.json(
      { error: 'Failed to calculate distance matrix' },
      { status: 500 }
    );
  }
}