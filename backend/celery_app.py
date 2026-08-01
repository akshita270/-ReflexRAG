from celery import Celery

celery_app = Celery(
    "reflexrag",
    broker="redis://localhost:6379/0",
    backend="redis://localhost:6379/2",
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    result_expires=86400,
)
