import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.const import CONF_ID
from esphome import automation
from esphome.components import microphone, speaker, esp32, socket

CODEOWNERS = ["@crearec"]
DEPENDENCIES = ["network"]

CONF_URL = "url"
CONF_TOKEN = "token"
CONF_DEVICE_ID = "device_id"
CONF_DISPLAY_NAME = "display_name"
CONF_ROOM = "room"
CONF_KIND = "kind"
CONF_MICROPHONE = "microphone"
CONF_SPEAKER = "speaker"

jarvis_ns = cg.esphome_ns.namespace("jarvis_gateway")
JarvisGateway = jarvis_ns.class_("JarvisGateway", cg.Component)
WakeAction = jarvis_ns.class_("WakeAction", automation.Action)

CONFIG_SCHEMA = cv.All(
    cv.Schema(
        {
            cv.GenerateID(): cv.declare_id(JarvisGateway),
            cv.Required(CONF_URL): cv.string,
            cv.Required(CONF_TOKEN): cv.string,
            cv.Required(CONF_DEVICE_ID): cv.string,
            cv.Optional(CONF_DISPLAY_NAME, default="Voice PE"): cv.string,
            cv.Optional(CONF_ROOM, default="kitchen_living"): cv.string,
            cv.Optional(CONF_KIND, default="esp"): cv.string,
            cv.Optional(CONF_MICROPHONE): cv.use_id(microphone.Microphone),
            cv.Optional(CONF_SPEAKER): cv.use_id(speaker.Speaker),
        }
    ).extend(cv.COMPONENT_SCHEMA),
    # esp_websocket_client connection to Core Voice Gateway
    socket.consume_sockets(1, "jarvis_gateway_websocket"),
)


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)
    cg.add(var.set_url(config[CONF_URL]))
    cg.add(var.set_token(config[CONF_TOKEN]))
    cg.add(var.set_device_id(config[CONF_DEVICE_ID]))
    cg.add(var.set_display_name(config[CONF_DISPLAY_NAME]))
    cg.add(var.set_room(config[CONF_ROOM]))
    cg.add(var.set_kind(config[CONF_KIND]))
    if CONF_MICROPHONE in config:
        mic = await cg.get_variable(config[CONF_MICROPHONE])
        cg.add(var.set_microphone(mic))
    if CONF_SPEAKER in config:
        spk = await cg.get_variable(config[CONF_SPEAKER])
        cg.add(var.set_speaker(spk))
    esp32.add_idf_component(
        name="espressif/esp_websocket_client",
        ref="1.4.0",
    )


@automation.register_action(
    "jarvis_gateway.wake",
    WakeAction,
    cv.Schema({cv.GenerateID(): cv.use_id(JarvisGateway)}),
    synchronous=True,
)
async def wake_action_to_code(config, action_id, template_arg, args):
    parent = await cg.get_variable(config[CONF_ID])
    return cg.new_Pvariable(action_id, template_arg, parent)
