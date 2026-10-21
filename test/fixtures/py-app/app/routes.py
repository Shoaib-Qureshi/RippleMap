from .models import User


def register(app):
    app.add_url_rule("/users", view_func=list_users)


def list_users():
    return [User("a")]
