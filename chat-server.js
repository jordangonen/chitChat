// Require the packages we will use:
var http = require("http"),
	socketio = require("socket.io"),
	fs = require("fs");
 
// Listen for HTTP connections.  This is essentially a miniature static file server that only serves our one file, client.html:
var app = http.createServer(function(req, resp){
	// This callback runs when a new connection is made to our HTTP server.
 
	fs.readFile("index.html", function(err, data){
		// This callback runs when the client.html file has been read from the filesystem.
 
		if(err) return resp.writeHead(500);
		resp.writeHead(200);
		resp.end(data);
	});
});
app.listen(3456);

//Global shit
var users = {};
var chatrooms = {};
chatrooms.Lobby = ["admin", "Lobby", "public", ""];
chatrooms.the_danger_zone = ["admin", "the_danger_zone", "public", ""];
var pms = {};

// Do the Socket.IO magic:
var io = socketio.listen(app);

io.sockets.on("connection", function(socket){
	
	//registration magic
	socket.on("register", function(data) {
		console.log(socket.id);
		if(data.nickname === "" || data.nickmake === null) { //idk what nickmake is but it works
			io.to(socket.id).emit("register_fail", {reason:"nullfield"});
		} else if(users.hasOwnProperty(data.nickname)) {
			io.to(socket.id).emit("register_fail", {reason:"exists"});
		} else {
			//put stuff in user array
			users[data.nickname] = [socket.id, data.nickname, "Lobby"];
			console.log("New user: " + data.nickname);
			io.to(users[data.nickname][0]).emit("register_success", {nick:users[data.nickname][1]});
		}
	});
	
	//message handling, sends messages based on chatroom
	socket.on("message_to_server", function(data) {
		console.log(data.nick + " said \"" + data.message + "\" in " + data.chat);
		for(var u in users) {
			if(data.chat === users[u][2]) {
				//console.log(io.to(users[u][0]));
				io.to(users[u][0]).emit("message_to_client", {
					msg:data.message,
					usr:data.nick
				});
			}
		}
	});
	
	//pm handling, sends pm back to either PM chat or to whatever chatroom the PM receiver is in
	socket.on("pm_to_server", function(data) {
		console.log(data.nick + " whispered \"" + data.message + "\" to " + data.pm);
		if(users[data.pm][2] === data.nick) {
			io.to(users[data.pm][0]).emit("message_to_client", {
				msg:data.message,
				usr:data.nick
			});
		} else {
			io.to(users[data.pm][0]).emit("pm_to_client", {
				msg:data.message,
				usr:data.nick
			});
		}
		io.to(users[data.nick][0]).emit("message_to_client", {
			msg:data.message,
			usr:data.nick
		});
	});
	
	//requesting user list, checks for whether or not it's a pm because that messes everything up
	socket.on("request_user_list", function(data) {
		//console.log(data.pm);
		var to_chat = data.chat;
		if(data.pm === "no") {
			var user_array = [];
			for(var u in users) {
				if(users[u][2] === to_chat) {
					user_array.push(users[u][1]);
				}
			}
			for(var v in users) {
				if(to_chat === users[v][2]) {
					io.to(users[v][0]).emit("receive_user_list", {
						usrarray:user_array,
						chat:chatrooms[data.chat],
						pm:"no"
					});
				}
			}
		} else {
			console.log(data.chat);
			var usr_array;
			if(users[data.chat][2] === data.usr) {
				usr_array = [data.usr];
				io.to(users[data.usr][0]).emit("receive_user_list", {
					usrarray:usr_array,
					chat:data.chat,
					pm:"yes"
				});
			} else {
				usr_array = [data.usr,data.chat];
				io.to(users[data.usr][0]).emit("receive_user_list", {
					usrarray:usr_array,
					chat:data.chat,
					pm:"yes"
				});
			}
		}
	});
	
	//room creation code, checks if chatroom does not exist
	socket.on("create_room", function(data) {
		var chatroom_dne = true;
		if(data.chatroom_name === "Lobby") {
			chatroom_dne = false;
		}
		for(var c in chatrooms) {
			if(data.chatroom_name === chatrooms[c][1]) {
				chatroom_dne = false;
			}
		}
		//console.log(chatroom_dne);
		//creates room if it does not exist
		if(chatroom_dne) {
			if(data.chatroom_name === "") { //input validation
				io.to(socket.id).emit("create_room_fail", {reason:"nullfield"});
			} else {
				chatrooms[data.chatroom_name] = [data.usr, data.chatroom_name, data.privacy, data.password];
				console.log("New chatroom: " + data.chatroom_name +", is " + data.privacy + " and has password " + data.password);
				io.sockets.emit("create_room_success", {room:data.chatroom_name});
			}
		} else {
			io.to(socket.id).emit("create_room_fail", {reason:"exists"});
		}
		//console.log(chatrooms);
	});
	
	//changes room, checks if room is private
	socket.on("change_room", function(data) {
		//console.log(users);
		if(data.pm === "no") {
			if(chatrooms[data.chat][2] === "private") {
				io.to(users[data.usr][0]).emit("password_required", {room:data.chat});
			} else {
				var is_creator = "false";
				users[data.usr][2] = data.chat;
				if(chatrooms[data.chat][0] === data.usr) {
					is_creator = "true";
				}
				io.to(users[data.usr][0]).emit("change_room_success", {room:data.chat, admin:is_creator});
				io.sockets.emit("someone_changed_rooms", {});
			}
		} else {
			users[data.usr][2] = data.chat;
			io.to(users[data.usr][0]).emit("change_pm_success", {pm:data.chat});
			io.sockets.emit("someone_changed_rooms", {});
		}
	});
	
	//request user kick
	socket.on("request_user_kick", function(data) {
		users[data.kicked][2] = "Lobby";
		//sends a whole emits to different sockets
		io.to(users[data.kicked][0]).emit("you_were_kicked");
		io.to(users[data.kicked][0]).emit("change_room_success", {room:"Lobby", admin:"false"});
		io.to(users[data.usr][0]).emit("kick_user_success");
	});
	
	//request user ban
	socket.on("request_user_ban", function(data) {
		var banned_chat = users[data.banned][2];
		users[data.banned][2] = "Lobby";
		io.to(users[data.banned][0]).emit("you_were_banned", {chat:banned_chat});
		io.to(users[data.banned][0]).emit("change_room_success", {room:"Lobby", admin:"false"});
		io.to(users[data.usr][0]).emit("ban_user_success");
	});
	
	//if you tried to join a password-protected room, you get this dude
	socket.on("change_password_room", function(data) {
		if(data.pass === "") {
			io.to(socket.id).emit("change_room_fail", {reason:"nullfield"});
		} else if(data.pass !== chatrooms[data.chat][3]) {
			io.to(socket.id).emit("change_room_fail", {reason:"incorrect_pass"});
		} else {
			var is_creator = "false";
			users[data.usr][2] = data.chat;
			if(chatrooms[data.chat][0] === data.usr) {
				is_creator = "true";
			}
			io.to(users[data.usr][0]).emit("change_room_success", {room:data.chat, admin:is_creator});
		}
	});
	
	//request chatroom list, sends chatroom array
	socket.on("request_chatroom_list", function() {
		io.sockets.emit("receive_chatroom_list", {chatroom_array:chatrooms});
		//console.log(chatrooms);
	});
	
	//create a pm room
	socket.on("create_private_message", function(data) {
		var pms_dne = true;
		for(var p in pms) {
			if((pms[p][0] === data.pm && pms[p][1] === data.usr) || (pms[p][1] === data.pm && pms[p][0] === data.usr)) {
				pms_dne = false;
			}
		}
		//if the pm does not exist
		if(pms_dne) {
			pms[data.usr] = [data.usr, data.pm];
			io.to(users[data.usr][0]).emit("create_pm_success", {name:data.pm});
			io.to(users[data.pm][0]).emit("added_to_pm", {usr:data.usr});
		} else {
			io.to(users[data.usr][0]).emit("create_pm_failed", {reason:"exists"});
		}
	});
	
	//broadcasts message to entire site
	socket.on("broadcast_message", function(data) {
		io.sockets.emit("message_to_all_users", {usr:data.usr, msg:data.message});
	});
	
	//checks if input is being checked and if so sends that back to appropriate channel
	socket.on("user_typing", function(data) {
		for(var u in users) {
			if(data.chat === users[u][2]) {
				io.to(users[u][0]).emit("typing", {usr:data.usr});
			}
		}
	});
});
