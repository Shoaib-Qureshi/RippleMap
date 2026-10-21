class User:
    def __init__(self, name):
        self.name = name

    def display(self):
        return self.format_name()

    def format_name(self):
        return self.name.title()
