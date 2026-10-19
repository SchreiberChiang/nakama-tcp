extends VehicleBody3D
# Synthetic inspection fixture, not an installed game.
func _physics_process(delta: float) -> void:
	engine_force = Input.get_action_strength("accelerate") * 900.0
	steering = Input.get_action_strength("steer") * 0.5
	DemoNet.upload_pose(global_transform, linear_velocity)
