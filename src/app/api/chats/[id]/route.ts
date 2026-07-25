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
    const chatRes = await query('SELECT * FROM pook_chats WHERE id = $1', [id]);
    if (chatRes.rows.length === 0) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }
    const chat = chatRes.rows[0];
    if (chat.user_id !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({ chat });
  } catch (err) {
    console.error('Failed to get Pook chat:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string })?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const { title } = await request.json();

  if (!title || typeof title !== 'string') {
    return NextResponse.json({ error: 'Invalid title' }, { status: 400 });
  }

  try {
    const chatRes = await query('SELECT user_id FROM pook_chats WHERE id = $1', [id]);
    if (chatRes.rows.length === 0) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }
    if (chatRes.rows[0].user_id !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const updateRes = await query(
      'UPDATE pook_chats SET title = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [title.trim(), id]
    );

    return NextResponse.json({ chat: updateRes.rows[0] });
  } catch (err) {
    console.error('Failed to rename Pook chat:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(
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

    await query('DELETE FROM pook_chats WHERE id = $1', [id]);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete Pook chat:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
