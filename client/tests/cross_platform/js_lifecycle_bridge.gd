extends RefCounted
## Test-only adapter for the lead-owned global `FoundationAcceptance` (WeChat package):
## subscribeLifecycle(callback) -> number handle, callback("hide"|"show"),
## unsubscribeLifecycle(handle), isHidden() -> bool. The JavaScript callback object is
## retained for the whole subscription and dropped only after unsubscribing.
const GLOBAL_NAME := "FoundationAcceptance"
const STATES := ["hide", "show"]
var _interface: Variant = null
var _create_callback := Callable()
var _callback: Variant = null
var _handle := 0
var _subscribed := false
var _handler := Callable()

func _init(bridge_interface: Variant, create_callback: Callable) -> void:
	_interface = bridge_interface
	_create_callback = create_callback

func subscribe(handler: Callable) -> bool:
	if _interface == null or _subscribed or not handler.is_valid() or not _create_callback.is_valid():
		return false
	_handler = handler
	_callback = _create_callback.call(_on_lifecycle)
	var handle: Variant = _interface.subscribeLifecycle(_callback)
	if not (handle is int or handle is float) or not is_finite(float(handle)) or float(handle) != floor(float(handle)) or float(handle) <= 0 or float(handle) > 9007199254740991.0:
		# Zero is the platform's failure sentinel. No subscription was acquired.
		release()
		return false
	_handle = int(handle)
	_subscribed = true
	return true

func is_hidden() -> bool:
	if _interface == null:
		return false
	var value: Variant = _interface.isHidden()
	return value is bool and value

func has_subscription() -> bool:
	return _subscribed and _callback != null

func subscription_handle() -> int:
	return _handle if _subscribed else -1

func release() -> void:
	if _interface != null and _subscribed:
		_interface.unsubscribeLifecycle(_handle)
	_subscribed = false
	_handle = 0
	_handler = Callable()
	_callback = null
	_interface = null
	_create_callback = Callable()

## JavaScriptBridge passes callback arguments as one Array.
func _on_lifecycle(args: Variant) -> void:
	if not _subscribed or not _handler.is_valid() or not args is Array or args.is_empty():
		return
	var state: Variant = args[0]
	if state is String and state in STATES:
		_handler.call(state)
