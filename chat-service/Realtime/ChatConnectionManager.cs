using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;

namespace ChatService.Realtime;

public class ChatConnectionManager
{
    // Первый ключ - комната чата, второй ключ - конкретное WebSocket-подключение внутри комнаты.
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<string, WebSocket>> _rooms = new();

    public string AddConnection(string roomKey, WebSocket socket)
    {
        var connectionId = Guid.NewGuid().ToString("N");
        var room = _rooms.GetOrAdd(roomKey, _ => new ConcurrentDictionary<string, WebSocket>());
        room[connectionId] = socket;
        return connectionId;
    }

    public void RemoveConnection(string roomKey, string connectionId)
    {
        if (_rooms.TryGetValue(roomKey, out var room))
        {
            room.TryRemove(connectionId, out _);
            if (room.IsEmpty) _rooms.TryRemove(roomKey, out _);
        }
    }

    public async Task BroadcastAsync(string roomKey, string payload, CancellationToken cancellationToken = default)
    {
        if (!_rooms.TryGetValue(roomKey, out var room)) return;

        // Одно сообщение рассылается всем открытым сокетам комнаты.
        var bytes = Encoding.UTF8.GetBytes(payload);
        var segment = new ArraySegment<byte>(bytes);

        foreach (var (_, socket) in room)
        {
            if (socket.State != WebSocketState.Open) continue;
            try
            {
                await socket.SendAsync(segment, WebSocketMessageType.Text, true, cancellationToken);
            }
            catch
            {
                // Ignore failed broadcast to individual socket.
            }
        }
    }
}
