import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { query } from '@/lib/db';

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string })?.id;

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const chatsRes = await query(
      'SELECT id, title, created_at, updated_at FROM pook_chats WHERE user_id = $1 ORDER BY updated_at DESC',
      [userId]
    );

    return NextResponse.json({ chats: chatsRes.rows });
  } catch (err) {
    console.error('Failed to fetch Pook chats:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string })?.id;

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { title } = await request.json();
    const chatTitle = title || 'New Pook Consultation';

    const createRes = await query(
      'INSERT INTO pook_chats (user_id, title) VALUES ($1, $2) RETURNING id, title, created_at, updated_at',
      [userId, chatTitle]
    );

    const chat = createRes.rows[0];

    return NextResponse.json({ chat });
  } catch (err) {
    console.error('Failed to create Pook chat:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
