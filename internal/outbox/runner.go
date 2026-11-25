package outbox

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"sync"
	"time"
)

// Handler runs one job. It is idempotent (a job may run again after a
// worker dies mid-way) and returns Permanent for an error retrying will not
// mend. It must stop when ctx ends: the job's timeout.
type Handler func(ctx context.Context, j Job) error

// Runner is the worker's loop: it claims due jobs of the kinds it has
// handlers for, runs up to Concurrency at a time, each under Timeout, and
// records a heartbeat every HeartbeatEvery.
type Runner struct {
	Queue       *Queue
	Handlers    map[string]Handler
	Worker      Worker
	Concurrency int
	Timeout     time.Duration
	// Poll is how often it looks for due jobs without a notification (retries come due so).
	Poll           time.Duration
	HeartbeatEvery time.Duration
	Logger         *slog.Logger
	// Alive is called after each heartbeat recorded (the healthcheck's file).
	Alive func()
}

// Kinds are the kinds the runner serves, sorted.
func (r *Runner) Kinds() []string {
	kinds := make([]string, 0, len(r.Handlers))
	for k := range r.Handlers {
		kinds = append(kinds, k)
	}
	sort.Strings(kinds)
	return kinds
}

func (r *Runner) defaults() {
	if r.Concurrency < 1 {
		r.Concurrency = 1
	}
	if r.Timeout <= 0 {
		r.Timeout = 5 * time.Minute
	}
	if r.Poll <= 0 {
		r.Poll = 10 * time.Second
	}
	if r.HeartbeatEvery <= 0 {
		r.HeartbeatEvery = 30 * time.Second
	}
	if r.Logger == nil {
		r.Logger = slog.Default()
	}
}

// Run works until ctx ends, then waits for the jobs it is running.
func (r *Runner) Run(ctx context.Context) error {
	r.defaults()
	kinds := r.Kinds()
	r.Worker.Kinds = kinds
	if r.Worker.StartedAt.IsZero() {
		r.Worker.StartedAt = r.Queue.now()
	}
	if err := r.Queue.Heartbeat(ctx, r.Worker); err != nil {
		return fmt.Errorf("outbox: first heartbeat: %w", err)
	}
	r.alive()
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		r.beat(ctx)
	}()
	defer wg.Wait()

	// A lease outlives the job's timeout, so a slow job is not taken twice.
	lease := r.Timeout + time.Minute
	slots := make(chan struct{}, r.Concurrency)
	var l *Listener
	defer func() {
		if l != nil {
			l.Close()
		}
	}()
	for ctx.Err() == nil {
		if l == nil {
			var err error
			if l, err = r.Queue.Listen(ctx); err != nil {
				r.Logger.Error("worker cannot listen", slog.Any("error", err))
				l = nil
				sleep(ctx, r.Poll)
				continue
			}
		}
		select {
		case slots <- struct{}{}:
		case <-ctx.Done():
			return nil
		}
		j, ok, err := r.Queue.Claim(ctx, r.Worker.Name, kinds, lease)
		if err != nil || !ok {
			<-slots
			if err != nil && ctx.Err() == nil {
				r.Logger.Error("worker cannot claim", slog.Any("error", err))
				sleep(ctx, r.Poll)
				continue
			}
			if err := l.Wait(ctx, r.Poll); err != nil {
				r.Logger.Warn("worker lost its listening connection", slog.Any("error", err))
				l.Close()
				l = nil
			}
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() { <-slots }()
			r.run(ctx, j)
		}()
	}
	return nil
}

// run runs the claimed job j and records how it went.
func (r *Runner) run(ctx context.Context, j Job) {
	start := time.Now()
	err := r.call(ctx, j)
	// The outcome is written even when ctx ended: the job was run.
	done, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	log := r.Logger.With(slog.String("kind", j.Kind), slog.String("job", j.ID.String()), slog.Int("attempt", j.Attempts),
		slog.Duration("took", time.Since(start)))
	if err == nil {
		if err := r.Queue.Done(done, j); err != nil {
			log.Error("job done but not recorded", slog.Any("error", err))
			return
		}
		log.Info("job done")
		return
	}
	if ctx.Err() != nil && !IsPermanent(err) {
		// The worker is stopping: the job goes back, its attempt not counted.
		if rerr := r.Queue.Release(done, j); rerr != nil {
			log.Warn("job stopped with the worker, left to its lease", slog.Any("error", rerr))
			return
		}
		log.Info("job stopped with the worker, given back")
		return
	}
	if ferr := r.Queue.Fail(done, j, err); ferr != nil {
		log.Error("job failed but not recorded", slog.Any("error", err), slog.Any("record_error", ferr))
		return
	}
	log.Warn("job failed", slog.Any("error", err), slog.Bool("permanent", IsPermanent(err) || j.Attempts >= j.MaxAttempts))
}

// call runs the handler under the timeout, a panic being an error.
func (r *Runner) call(ctx context.Context, j Job) (err error) {
	h, ok := r.Handlers[j.Kind]
	if !ok {
		return Permanent(fmt.Errorf("no handler for %s", j.Kind))
	}
	jobCtx, cancel := context.WithTimeout(ctx, r.Timeout)
	defer cancel()
	defer func() {
		if p := recover(); p != nil {
			err = fmt.Errorf("panic: %v", p)
		}
	}()
	err = h(jobCtx, j)
	if err != nil && errors.Is(jobCtx.Err(), context.DeadlineExceeded) && ctx.Err() == nil {
		return fmt.Errorf("timed out after %s", r.Timeout)
	}
	return err
}

func (r *Runner) beat(ctx context.Context) {
	tick := time.NewTicker(r.HeartbeatEvery)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			if err := r.Queue.Heartbeat(ctx, r.Worker); err != nil {
				if ctx.Err() == nil {
					r.Logger.Error("worker heartbeat failed", slog.Any("error", err))
				}
				continue
			}
			r.alive()
		}
	}
}

func (r *Runner) alive() {
	if r.Alive != nil {
		r.Alive()
	}
}

func sleep(ctx context.Context, d time.Duration) {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}

// Alive is whether w beat within the last 2 minutes.
func Alive(w Worker, now time.Time) bool { return now.Sub(w.SeenAt) < 2*time.Minute }
