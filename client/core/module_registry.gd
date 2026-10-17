class_name ModuleRegistry
extends RefCounted
## Add your own module here. No fixture, game scene or preview is loaded by default.
static var modules: Dictionary = {}

static func register_module(id: String, factory: Callable, metadata: Dictionary = {}) -> void:
	assert(not id.is_empty() and factory.is_valid() and not modules.has(id))
	modules[id] = {"factory": factory, "metadata": metadata.duplicate(true)}

static func create(id: String) -> GameModule:
	if not modules.has(id):
		return null
	return modules[id].factory.call() as GameModule

static func join_metadata(id: String) -> Dictionary:
	var result: Dictionary = {}
	if modules.has(id):
		for key in modules[id].metadata.get("join_metadata", {}):
			if key not in ["display_name", "room_phase_version"]:
				result[str(key)] = str(modules[id].metadata.join_metadata[key])
	return result
