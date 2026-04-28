# CommandCenter Backend

FastAPI + PostgreSQL backend for CommandCenter task management system.

## Features

- ✅ Full CRUD API for Tasks, Projects, Habits, Time Entries, Notes, etc.
- ✅ PostgreSQL database for persistent storage
- ✅ JWT authentication with user accounts
- ✅ Stats/completions tracked forever
- ✅ Docker + Docker Compose for easy deployment
- ✅ Auto-reload during development

## Quick Start

### Prerequisites
- Docker + Docker Compose installed
- Or: Python 3.11+ + PostgreSQL

### Option 1: Docker (Recommended)

```bash
# Start all services
docker-compose up

# Backend: http://localhost:8000
# Docs: http://localhost:8000/docs
# ReDoc: http://localhost:8000/redoc
```

### Option 2: Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Create .env file
cp .env.example .env

# Start PostgreSQL (install locally first)
# Then run:
python main.py
```

## Project Structure

```
backend/
├── main.py              # FastAPI app + all route handlers
├── models.py            # SQLAlchemy ORM models (User, Task, Project, etc.)
├── schemas.py           # Pydantic request/response schemas
├── auth.py              # JWT authentication + token management
├── db.py                # Database connection setup
├── requirements.txt     # Python dependencies
├── Dockerfile           # Container definition
├── docker-compose.yml   # Services orchestration
├── .env.example         # Environment variable template
└── README.md            # This file
```

## API Endpoints

### Auth
- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Login & get token

### Tasks
- `GET /api/tasks/` - List tasks (with filters: status, search)
- `GET /api/tasks/today` - Today's tasks
- `POST /api/tasks/` - Create task
- `GET /api/tasks/{id}` - Get task
- `PATCH /api/tasks/{id}` - Update task
- `DELETE /api/tasks/{id}` - Delete task
- `POST /api/tasks/{id}/complete` - Mark complete
- `POST /api/tasks/reorder` - Reorder tasks

### Projects
- `GET /api/projects/` - List projects
- `POST /api/projects/` - Create project
- `GET /api/projects/{id}` - Get project
- `PATCH /api/projects/{id}` - Update project
- `DELETE /api/projects/{id}` - Delete project

### Habits
- `GET /api/habits/` - List habits
- `POST /api/habits/` - Create habit
- `POST /api/habits/{id}/complete` - Mark complete
- `GET /api/habits/{id}/streak` - Get streak

### Time Entries
- `GET /api/time-entries/active` - Get active timer
- `POST /api/time-entries/start` - Start timer
- `POST /api/time-entries/{id}/stop` - Stop timer

### Time Blocks
- `GET /api/time-blocks/?date=YYYY-MM-DD` - Get blocks for date
- `POST /api/time-blocks/` - Create block
- `DELETE /api/time-blocks/{id}` - Delete block

### Dashboard
- `GET /api/dashboard/` - Get dashboard summary (today's stats)

### More
- Tags, Categories, Notes, CRM, Braindump - all have standard CRUD

## Authentication

All endpoints except `/api/auth/register` and `/api/auth/login` require a JWT token.

### Login
```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'
```

Response:
```json
{
  "access_token": "eyJhbGc...",
  "token_type": "bearer"
}
```

### Use Token
```bash
curl -X GET http://localhost:8000/api/tasks/ \
  -H "Authorization: Bearer eyJhbGc..."
```

## Database Schema

Key tables:
- **users** - User accounts (email + password hash)
- **tasks** - Tasks with priority, focus score, status
- **projects** - Project containers for tasks
- **habits** - Recurring habits
- **habit_completions** - Daily completion records (never deleted!)
- **time_entries** - Timer entries linked to tasks
- **time_blocks** - Calendar blocks (day planner)
- **notes** - User notes
- **tags, categories** - Metadata
- **crm_people** - Contact management
- **braindump_entries** - Raw thoughts/ideas

All records include:
- `id` (UUID)
- `user_id` (FK to users - ensures data isolation)
- `created_at` (timestamp)
- Most have `updated_at` for modification tracking

## Stats Persistence

Every completed task, habit completion, and timer entry is stored in the database with timestamps. This data is:

✅ Permanent - never deleted when you make changes
✅ Queryable - build reports/dashboards from historical data
✅ Isolated - only visible to that user
✅ Indexed - fast lookups even with years of data

Example: Get all completed tasks for a date range:
```sql
SELECT * FROM tasks 
WHERE user_id = '...' 
  AND status = 'done'
  AND completed_at BETWEEN '2024-01-01' AND '2024-12-31'
ORDER BY completed_at DESC;
```

## Environment Variables

Create `.env` file:
```env
# Database (auto-created by docker-compose)
DATABASE_URL=postgresql://postgres:postgres@db:5432/commandcenter

# Security
SECRET_KEY=your-secret-key-at-least-32-chars-long

# Optional
DEBUG=false
LOG_LEVEL=info
```

### Production Checklist
- [ ] Change `SECRET_KEY` to random 32+ character string
- [ ] Use strong database password
- [ ] Set `DEBUG=false`
- [ ] Enable HTTPS on frontend
- [ ] Add rate limiting
- [ ] Set up monitoring/logging
- [ ] Regular backups of Postgres

## Development

### Running Tests
```bash
pip install pytest pytest-asyncio
pytest
```

### Database Migrations

Using Alembic (optional):
```bash
alembic init alembic

# After changing models:
alembic revision --autogenerate -m "Add user_name field"
alembic upgrade head
```

### API Documentation

Automatic docs available at:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Deployment

### Option 1: Railway.app (Simplest)
1. Push code to GitHub
2. Create Railway project
3. Add PostgreSQL database
4. Connect GitHub repo
5. Set env vars (DATABASE_URL, SECRET_KEY)
6. Deploy!

### Option 2: Render
1. Create Postgres database
2. Create Web Service from GitHub
3. Set environment variables
4. Deploy

### Option 3: Self-Hosted (Docker)
```bash
# Build image
docker build -t commandcenter-backend .

# Run with external Postgres
docker run -e DATABASE_URL=... -p 8000:8000 commandcenter-backend
```

## Troubleshooting

**"connection refused"**
- Check Docker containers: `docker-compose ps`
- Check logs: `docker-compose logs backend`

**"relation \"users\" does not exist"**
- Database not initialized
- Check `init_db()` runs on startup

**"Invalid token"**
- Token expired (30 days default)
- Wrong SECRET_KEY in production

**"integrity error"**
- Duplicate email on registration
- Foreign key constraint (project deleted but task still references it)

## Contributing

1. Fork repo
2. Create branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m "Add amazing feature"`)
4. Push (`git push origin feature/amazing`)
5. Open PR

## License

MIT
