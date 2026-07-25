import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { query } from '@/lib/db';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string })?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  try {
    const chatRes = await query('SELECT user_id FROM pook_chats WHERE id = $1', [id]);
    if (chatRes.rows.length === 0) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }
    if (chatRes.rows[0].user_id !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const messagesRes = await query(
      'SELECT id, role, content, image_url, created_at FROM pook_messages WHERE chat_id = $1 ORDER BY created_at ASC',
      [id]
    );

    return NextResponse.json({ messages: messagesRes.rows });
  } catch (err) {
    console.error('Failed to get Pook chat messages:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
