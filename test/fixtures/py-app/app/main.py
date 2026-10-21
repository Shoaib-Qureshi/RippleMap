from flask import Flask
from .routes import register
from app import utils
import app.models

flask_app = Flask(__name__)


@flask_app.route("/")
def index():
    return utils.greet()


def boot():
    register(flask_app)
