extends Node
var peer := ENetMultiplayerPeer.new()
func host_demo() -> void:
	peer.create_server(19000, 4)
	multiplayer.multiplayer_peer = peer
func upload_pose(pose: Transform3D, speed: Vector3) -> void:
	accept_pose.rpc(pose, speed)
@rpc("any_peer", "call_remote", "unreliable")
func accept_pose(pose: Transform3D, speed: Vector3) -> void:
	get_node("/root/Demo/Car").global_transform = pose
