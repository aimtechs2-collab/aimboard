import { Server as SocketIOServer } from "socket.io";

export function attachRealtimeServer(server) {
  const io = new SocketIOServer(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Accept", "Authorization"],
      credentials: false,
    },
    transports: ["websocket", "polling"],
    allowEIO3: true,
  });

  const SOCKET_ROOMS = new Map();

  io.on("connection", (socket) => {
    socket.emit("init-room");

    socket.on("join-room", (roomId) => {
      socket.join(roomId);

      let roomSockets = SOCKET_ROOMS.get(roomId);
      if (!roomSockets) {
        roomSockets = new Set();
        SOCKET_ROOMS.set(roomId, roomSockets);
        socket.emit("first-in-room");
      } else if (roomSockets.size === 0) {
        socket.emit("first-in-room");
      }
      roomSockets.add(socket.id);

      socket.to(roomId).emit("new-user", socket.id);
      io.in(roomId).emit("room-user-change", Array.from(roomSockets));
    });

    socket.on("server-broadcast", (roomId, encryptedData, iv) => {
      socket.to(roomId).emit("client-broadcast", encryptedData, iv);
    });

    socket.on("server-volatile-broadcast", (roomId, encryptedData, iv) => {
      socket.to(roomId).volatile.emit("client-broadcast", encryptedData, iv);
    });

    socket.on("user-follow", () => {
      const rooms = Array.from(socket.rooms);
      if (rooms.length > 1) {
        socket.to(rooms[1]).emit("user-follow-room-change", [socket.id]);
      }
    });

    socket.on("disconnecting", () => {
      for (const roomId of socket.rooms) {
        if (roomId !== socket.id) {
          const roomSockets = SOCKET_ROOMS.get(roomId);
          if (roomSockets) {
            roomSockets.delete(socket.id);
            if (roomSockets.size === 0) {
              SOCKET_ROOMS.delete(roomId);
            } else {
              io.in(roomId).emit("room-user-change", Array.from(roomSockets));
            }
          }
        }
      }
    });
  });

  return io;
}
