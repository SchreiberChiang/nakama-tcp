extends "res://core/session.gd"
## Test-only Session for cross-platform acceptance packages. Never the production autoload.
## Applies isolated-project connection settings after the original _ready() and, only
## when a package explicitly enables allow_insecure_lan, admits plain HTTP/WS to a
## literal RFC1918 IPv4 address. Every other rule stays with the original Session.
const SETTING_PREFIX := "cross_platform/"
var cross_platform_enabled := false
var allow_insecure_lan := false
## Fixed flag only; rejected setting values are never stored, printed or displayed.
var cross_platform_config_rejected := false

func _ready() -> void:
	super._ready()
	apply_cross_platform_settings()

func apply_cross_platform_settings() -> void:
	cross_platform_config_rejected = false
	allow_insecure_lan = false
	cross_platform_enabled = ProjectSettings.get_setting(SETTING_PREFIX + "enabled", false) == true
	if not cross_platform_enabled:
		return
	var host_value: Variant = ProjectSettings.get_setting(SETTING_PREFIX + "host", host)
	if host_value is String and not host_value.strip_edges().is_empty() and host_value.strip_edges().length() <= 253:
		host = host_value.strip_edges()
	else:
		cross_platform_config_rejected = true
	var port_value: Variant = ProjectSettings.get_setting(SETTING_PREFIX + "port", port)
	if _whole(port_value) and int(port_value) >= 1 and int(port_value) <= 65535:
		port = int(port_value)
	else:
		cross_platform_config_rejected = true
	tls = _flag("tls", tls)
	allow_insecure_lan = _flag("allow_insecure_lan", false)
	diagnostics.set_enabled(_flag("diagnostics", diagnostics.enabled))

func _flag(key: String, fallback: bool) -> bool:
	var value: Variant = ProjectSettings.get_setting(SETTING_PREFIX + key, fallback)
	if value is bool:
		return value
	cross_platform_config_rejected = true
	return fallback

static func _whole(value: Variant) -> bool:
	return (value is int or value is float) and is_finite(float(value)) and float(value) == floor(float(value))

func _valid_connection() -> bool:
	if super._valid_connection():
		return true
	return cross_platform_enabled and allow_insecure_lan and not tls and port > 0 and port <= 65535 and is_private_lan_ipv4(host)

## Literal dotted-quad only: no hostnames, ports, whitespace, leading zeros or other ranges.
static func is_private_lan_ipv4(value: String) -> bool:
	var parts := value.split(".", true)
	if parts.size() != 4:
		return false
	var octets: Array[int] = []
	for part in parts:
		if part.is_empty() or part.length() > 3 or not part.is_valid_int() or (part.length() > 1 and part.begins_with("0")):
			return false
		for character in part:
			if character < "0" or character > "9":
				return false
		var octet := int(part)
		if octet < 0 or octet > 255:
			return false
		octets.append(octet)
	if octets[0] == 10:
		return true
	if octets[0] == 172 and octets[1] >= 16 and octets[1] <= 31:
		return true
	return octets[0] == 192 and octets[1] == 168
